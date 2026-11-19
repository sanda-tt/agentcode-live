import { randomUUID } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const inject = ['agents', 'tools', 'workspaceRegistry', 'sessionController'];

export function apply(ctx) {
  ctx.effect(() => {
    const lifetime = new AbortController();
    void exercise(ctx, lifetime.signal).catch(error => {
      if (!lifetime.signal.aborted) ctx.logger.error('AgentCode Web fixture failed: %s', error.message);
    });
    return () => lifetime.abort();
  });
}

async function exercise(ctx, signal) {
  const cwd = process.env.AGENTCODE_DSH_PANEL_ROOT;
  const workspace = await ctx.workspaceRegistry.create(cwd, 'AgentCode Web fixture');
  const { sessionId } = await ctx.sessionController.create({ workspaceId: workspace.id });
  const agent = ctx.agents.get(sessionId);
  if (!agent) throw new Error('Fixture Session has no Agent');
  await writeFile(join(cwd, 'ready'), sessionId);

  for (const [turn, value] of [[1, 23], [2, 24]]) {
    while (!signal.aborted) {
      try { await access(join(cwd, 'trigger-' + turn)); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 120)); }
    }
    signal.throwIfAborted();
    // Drive the native executor directly. DSH commits its own tool result.
    agent.session.append('turn/start', { turn });
    agent.session.append('step/start', { turn, step: 1 });
    const result = await ctx.tools.execute({
      calls: [{
        type: 'tool-call', id: randomUUID(), name: 'write',
        arguments: JSON.stringify({ file_path: 'panel_demo.c', content: 'int panel_demo(void) { return ' + value + '; }\n' }),
      }],
      agent, log: { turn, step: 1 }, signal,
    });
    const completed = result.results[0]?.result;
    if (!completed || completed.isError) throw new Error('Built-in write failed: ' + JSON.stringify(completed?.content));
    agent.session.append('step/end', { turn, step: 1 });
    agent.session.append('turn/end', { turn, reason: { kind: 'completed' } });
  }
}
