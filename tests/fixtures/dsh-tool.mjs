import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const inject = ['tools'];
export async function apply(ctx) {
  const { defineTool } = await import(pathToFileURL(process.env.AGENTCODE_DSH_TOOLS));
  ctx.tools.register(defineTool({
    name: 'agentcode_acceptance_write',
    description: 'Write the isolated acceptance fixture.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      await writeFile(process.env.AGENTCODE_DSH_DEMO_FILE, 'int harness(void) { return 42; }\n');
      return 'wrote fixture';
    },
  }));
  setTimeout(() => {
    void ctx.tools.execute({
      calls: [{ type: 'tool-call', id: 'agentcode-acceptance', name: 'agentcode_acceptance_write', arguments: '{}' }],
      signal: AbortSignal.timeout(8000),
    }).catch(error => ctx.logger.warn(error.message));
  }, 600);
}
