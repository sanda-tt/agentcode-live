import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileActivityProjection } from './changes.js';

export const name = 'agentcode-live';
export const inject = ['tools', 'sessions'];

export function apply(ctx, config) {
  ctx.inject(['sessionProjections'], async scoped => {
    await scoped.sessionProjections.register(fileActivityProjection);
  });
  const descriptor = config?.descriptor ?? process.env.AGENTCODE_LIVE_DSH_DESCRIPTOR;
  if (typeof descriptor !== 'string' || !isAbsolute(descriptor)) {
    ctx.logger.warn('[AgentCode Live] Set AGENTCODE_LIVE_DSH_DESCRIPTOR to the absolute path copied from VS Code.');
    return;
  }
  ctx.effect(() => {
    const runtimeId = randomUUID();
    const queue = [];
    let stopped = false;
    let busy = false;
    let connected = false;
    let lastError = 0;
    const lifetime = new AbortController();

    async function send(event, freshSignal = false) {
      const { version, key, port } = JSON.parse(await readFile(descriptor, 'utf8'));
      if (version !== 1 || !Number.isInteger(port) || port < 1 || port > 65535 ||
          typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)) throw new Error('Invalid descriptor');
      const deadline = AbortSignal.timeout(1200);
      const response = await fetch(`http://127.0.0.1:${port}/event`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeId, ...event }),
        redirect: 'error',
        signal: freshSignal ? deadline : AbortSignal.any([deadline, lifetime.signal]),
      });
      if (!response.ok) throw new Error('Receiver rejected event');
    }

    async function flush() {
      if (busy || stopped) return;
      busy = true;
      try {
        if (!queue.length) await send({ type: 'heartbeat' });
        while (!stopped && queue.length) {
          await send(queue[0]);
          queue.shift();
        }
        if (!connected && !stopped) ctx.logger.info('[AgentCode Live] Connected to VS Code.');
        connected = true;
      } catch {
        connected = false;
        if (!stopped && Date.now() - lastError > 30000) {
          lastError = Date.now();
          ctx.logger.info('[AgentCode Live] Waiting for the VS Code bridge.');
        }
      } finally { busy = false; }
    }

    function report(type, fields = {}) {
      if (queue.length >= 128) return;
      queue.push({ type, ...fields });
      void flush();
    }

    function tool(exec) {
      return { sessionId: exec.agent?.session?.id, itemId: exec.callId, tool: exec.name };
    }

    ctx.on('session/created', session => report('session/created', { sessionId: session.id }), { global: true });
    ctx.on('session/disposed', session => report('session/disposed', { sessionId: session.id }), { global: true });
    ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start' || event.type === 'turn/end') {
        report(event.type, { sessionId: session.id, turnId: event.data.turn, error: event.data.reason?.kind === 'error' });
      }
    }, { global: true });
    ctx.on('tools/execute', (exec, next) => {
      report('tools/execute', tool(exec));
      return next();
    }, { global: true });
    ctx.on('tools/result', (exec, result) => {
      report('tools/result', { ...tool(exec), error: result.isError });
    }, { global: true });

    ctx.logger.info('[AgentCode Live] Native Cordis plugin loaded.');
    const timer = setInterval(() => void flush(), 5000);
    timer.unref();
    void flush();
    return () => {
      stopped = true;
      clearInterval(timer);
      lifetime.abort();
      queue.length = 0;
      if (connected) void send({ type: 'goodbye' }, true).catch(() => {});
    };
  }, 'agentcode-live bridge');
}
