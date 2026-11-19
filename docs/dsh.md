# DeepSeek Harness installation · DSH 原生插件安装

AgentCode Live pins its DSH Cordis bundle to official DeepSeek Harness `0.2.2-rc.5`. DSH requires Node.js 24.9.0 or later.

## Install the bundle in its own Web profile

Download `dsh-agentcode-live-0.1.1.tgz` from GitHub Releases and run these commands from its download directory.

    npx -y @deepseek-ai/dsh@0.2.2-rc.5 --version
    npx -y @deepseek-ai/dsh@0.2.2-rc.5 agentcode-web --from-default-profile web --dump-config
    npx -y @deepseek-ai/dsh@0.2.2-rc.5 plugin --profile agentcode-web add ./dsh-agentcode-live-0.1.1.tgz

Run the profile initialization command once. A subsequent use of `--from-default-profile` replaces that named custom profile with its default template. Use an unused profile name if you already have `agentcode-web`.

1. Open the same project in VS Code and run **Enable DSH Bridge and Copy Descriptor Path** or 「启用 DSH 桥接并复制描述文件路径」.
2. In PowerShell run the following with the descriptor path just copied. The variable is for this terminal and its child process.

       $env:AGENTCODE_LIVE_DSH_DESCRIPTOR = Get-Clipboard
       npx -y @deepseek-ai/dsh@0.2.2-rc.5 agentcode-web

3. Visit the URL printed by DSH. Sign in or configure a model using the official DSH UI to run a model-driven task. The Agent Activity view shows DSH lifecycle and tool activity. The VS Code observer separately picks up changes under its trusted local workspace.

## Web File activity tab · Web 文件活动页

In an active DSH Web session, select **File activity** or 「文件活动」 in the session's view bar. It updates as DSH commits a successful file-tool result and retains up to 40 entries in the current session view. Paths and statuses are shown. Source text, tool arguments and the VS Code bridge key are excluded from this panel. Shell writes remain visible through the VS Code Observer. The Web tab also works when VS Code bridge forwarding is off.

打开有活动记录的 DSH Web 会话，切换至「文件活动」。原生文件工具完成后，列表自动更新。此处展示路径和操作状态。Shell 写入及完整磁盘差异可在 VS Code 观察模式中查看。

[Verified DSH Web screenshot · 浏览器实测截图](images/dsh-file-activity.png)

## Reload and uninstall · 重载与卸载

The bridge binds to IPv4 localhost and authenticates with a per-launch random token in the descriptor file. Keep that file local to the host. On VS Code reload it publishes a new endpoint at the same path. The plugin retries on a heartbeat and queues at most 128 events during a disconnect. Stop the DSH Web process and restart the profile to reload the bundle. To uninstall:

    npx -y @deepseek-ai/dsh@0.2.2-rc.5 plugin --profile agentcode-web remove dsh-agentcode-live

The DSH plugin sends tool names, a small set of status fields and event/session identifiers to VS Code. Arguments, outputs, prompt text and file contents stay out of its transport. It belongs to the DSH process you launch with the descriptor.

If VS Code says **Disconnected**, check that both processes are on the same host and that the environment variable holds the existing absolute descriptor path. Use a dedicated profile so events from unrelated DSH work do not appear in this workspace. [Official DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
