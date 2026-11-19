# Architecture decisions

1. Keep the TypeScript event contract independent of VS Code. The filesystem adapter publishes captured text snapshots. Native adapters publish independently sourced metadata or patches. A filesystem event remains attributed to Unknown even when a provider tool ran nearby.
2. Use official VS Code watchers, decorations, a tree provider, a virtual document provider and a sandboxed Webview. Follow opens a background editor beside the active group. Replay and Cinematic consume archived data without writing source.
3. Reuse jsdiff for bounded comparisons and ignore for gitignore semantics. Each root is scanned once for a baseline. Watch notifications are batched. VS Code rename events are authoritative. A unique same-content delete/create pair during an external batch is an inference.
4. Use VS Code workspace storage for bounded history, flushed into an atomically replaced JSONL file. Turn and tool metadata omit prompts, shell arguments and tool output.
5. Start a dedicated Codex App Server over stdio. DSH uses official Cordis lifecycle and tool callbacks and sends an allowlist of fields through an authenticated localhost receiver.

We reviewed [Change Agent Watch](https://github.com/DamianEdwards/vsc-change-agent-watch) for native file following and [Tellurion](https://github.com/steventsvik/Tellurion) for agent activity design. AgentCode Live combines workspace snapshots, provider provenance and read-only replay in VS Code.

The roadmap includes optional DSH Web integration, history export and additional native providers.
