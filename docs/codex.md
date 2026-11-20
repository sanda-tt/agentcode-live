# Codex integration · Codex 接入

**English** · [简体中文](codex.zh-CN.md)

## Observer · 观察模式

Install AgentCode Live, open a trusted local folder, and run the official Codex VS Code extension or `codex` in that folder. The observer sees captured workspace writes even when Codex used a shell or applied a large patch. Disk paths remain attributed to **Unknown**. Existing extension and CLI sessions can keep their own login, configuration and tools.

安装后直接运行本来的 Codex。观察模式会展示工作区磁盘变化，磁盘事件保持「未知」归因。

## Managed Codex · 托管 Codex

1. Install and sign in to the official Codex CLI. Check `codex --version` and `codex login status`.
2. If VS Code cannot find the binary, set `agentcodeLive.codexExecutable` to the absolute executable path in user settings. On Windows use `codex.exe`.
3. Run **AgentCode Live: Send a Managed Codex Prompt** or 「向托管 Codex 发送任务」. Select a local workspace root if needed, and enter a task. A dedicated App Server owns a transient thread in that workspace. Additional prompts in the same workspace reuse the active thread.
4. The activity view receives native turn and command status, file-change items when emitted by the server, and turn diff updates. Eligible per-file patches can be opened in the editor. It also receives independent disk snapshots. Use **Disconnect Managed Codex** to stop the process. After a disconnect, submitting a new task creates a fresh thread.

Managed mode uses `workspace-write` with approval policy `never`. Operations that need additional permission cannot be approved from this UI. Prompts, command arguments and full combined diffs are omitted from AgentCode Live history. Native per-file patches are limited to eligible workspace paths. There is no attachment to an existing Codex VS Code extension session. This UI is for controlled workspace tasks, with activity as its interface.

Compatible protocol fields were checked using `codex app-server generate-json-schema` from Codex CLI 0.169.1. [Official App Server reference](https://learn.chatgpt.com/docs/app-server)
