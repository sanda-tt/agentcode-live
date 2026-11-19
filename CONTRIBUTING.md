# Contributing

Install Node.js 24 and run `npm ci`. Run `npm test` for core and transport tests and `npm run test:vscode` for a real isolated VS Code Extension Development Host. Set `AGENTCODE_VSCODE` to the executable path to use an installed VS Code. The runner otherwise downloads its pinned test build.

Set `AGENTCODE_TEST_CODEX=1` and, if necessary, `AGENTCODE_CODEX` to an authenticated Codex executable for live agent acceptance. For DSH, set `AGENTCODE_DSH_CLI` and `AGENTCODE_DSH_TOOLS` to the installed official packages' `dsh/lib/bin.js` and `dsh-tools/lib/index.js`. Both checks use isolated project data. The DSH test invokes a real Cordis tool and needs no model key.

Use the example project or a temporary workspace for reports and screenshots. Include the observed event, its expected provenance and relevant versions. Remove private paths, source and credentials from logs.

Keep adapters independent from UI. File snapshots come from disk observation. Native activity carries explicit agent identity and its own session ID. Presentation consumes recorded data through read-only views.

Run `npm run package` and `npm run package:dsh` when changing a distributable package.
