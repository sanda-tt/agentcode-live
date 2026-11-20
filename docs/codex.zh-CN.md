# Codex 接入指南

[English](codex.md) · **简体中文**

## 观察模式

安装 AgentCode Live 后，在 VS Code 中打开受信任的本地目录。使用原来的 Codex 扩展，或在该目录中运行 `codex`。无论 Codex 使用 Shell 写入文件还是应用较大的补丁，观察器都会捕获工作区的落盘变化。仅来自磁盘的事件标为「未知」。已有会话继续使用自己的登录、配置和工具。

## 托管模式

1. 安装并登录官方 Codex CLI。用 `codex --version` 和 `codex login status` 检查版本和登录状态。
2. 如果 VS Code 找不到 CLI，在用户设置中将 `agentcodeLive.codexExecutable` 设为可执行文件的绝对路径。Windows 上使用 `codex.exe`。
3. 在命令面板运行「AgentCode Live: 向托管 Codex 发送任务」。如有多个工作区根目录，选择一个，再输入任务。扩展会启动独立 App Server 并为该工作区建立会话。后续任务会复用当前会话。
4. 活动视图会显示原生任务轮次、命令状态、服务端报告的文件变更及轮次差异。符合条件的单文件补丁可以在编辑器中打开。磁盘快照也会独立记录。运行「断开托管 Codex」可停止 App Server，再次提交任务将开启新会话。

托管模式使用 `workspace-write` 和 `never` 审批策略，需额外权限的操作无法通过此模式批准。扩展历史省略提示词、命令参数和完整轮次差异。单文件补丁仅限符合观察规则的工作区路径。已有 Codex 扩展会话请使用观察模式。

协议字段通过 Codex CLI 0.169.1 的 `codex app-server generate-json-schema` 检查。[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)
