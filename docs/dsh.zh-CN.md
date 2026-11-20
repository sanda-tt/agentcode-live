# DeepSeek Harness 原生插件安装

[English](dsh.md) · **简体中文**

AgentCode Live 的 Cordis 插件适配官方 DeepSeek Harness `0.2.2-rc.5`，需要 Node.js 24.9.0 或更新版本。

## 安装到独立 Web 配置

从 [GitHub Releases](https://github.com/sanda-tt/agentcode-live/releases) 下载 `dsh-agentcode-live-0.1.1.tgz`，在下载目录运行：

```powershell
npx -y @deepseek-ai/dsh@0.2.2-rc.5 --version
npx -y @deepseek-ai/dsh@0.2.2-rc.5 agentcode-web --from-default-profile web --dump-config
npx -y @deepseek-ai/dsh@0.2.2-rc.5 plugin --profile agentcode-web add ./dsh-agentcode-live-0.1.1.tgz
```

首次创建 Web 配置时运行 `--from-default-profile`。再次执行会用默认模板替换该配置。若已有 `agentcode-web`，请为新配置选一个未使用的名称。

1. 在 VS Code 打开同一个项目，运行「启用 DSH 桥接并复制描述文件路径」。
2. 在 PowerShell 中读取刚复制的路径并启动 DSH。环境变量仅对当前终端及其子进程生效。

   ```powershell
   $env:AGENTCODE_LIVE_DSH_DESCRIPTOR = Get-Clipboard
   npx -y @deepseek-ai/dsh@0.2.2-rc.5 agentcode-web
   ```

3. 打开 DSH 输出的 URL，通过官方界面登录或配置模型，再执行任务。VS Code 的 Agent 活动会收到 DSH 的会话与工具事件。受信任工作区中的磁盘变更由观察器独立捕获。

## Web 文件活动页

在 DSH Web 会话的视图栏打开「文件活动」或 **File activity**。页面跟随 DSH Web 的界面语言，在原生文件工具成功执行后更新，每个会话视图最多保留 40 条记录。这里展示文件路径和操作状态，Shell 写入和完整差异可在 VS Code 观察模式查看。VS Code 桥接关闭时，Web 的文件活动页仍可独立使用。[浏览器实测截图](images/dsh-file-activity.png)

## 本地模型

可在 DSH 官方供应商设置中填入本机的 OpenAI Chat Completions 地址、模型标识和本地凭据。项目已验证 DSH 无界面任务通过 llama.cpp b12549 上运行的 Qwen3-4B Q4_K_M 写入文件，并收到原生写入事件。[DSH 模型配置](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)

## 重载、卸载与排查

桥接仅监听 IPv4 本机回环地址，使用描述文件中的随机令牌认证。请将描述文件留在本机。VS Code 重载后会在同一路径更新描述文件。插件通过心跳重试，断开期间最多暂存 128 条事件。要重载插件，先停止 DSH Web，再启动该配置。卸载命令如下。

```powershell
npx -y @deepseek-ai/dsh@0.2.2-rc.5 plugin --profile agentcode-web remove dsh-agentcode-live
```

桥接传输工具名称、状态和事件标识，工具参数、输出、提示词和文件内容留在原进程。若 VS Code 显示「已断开」，检查两个进程是否运行在同一台机器上，以及环境变量是否指向存在的绝对路径。用独立配置可避免同一工作区收到无关的 DSH 任务事件。[官方 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
