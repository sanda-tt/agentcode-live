# AgentCode Live

[English](README.md) · **简体中文**

像观看真人远程编程一样，实时观察 AI Agent 修改项目。

AgentCode Live 在 VS Code 中观察工作区文件变化，并在编辑器、资源管理器和本地时间线中展示快照。它支持现有的 Codex 扩展、Codex CLI、DeepSeek Harness 和外部脚本。

![VS Code 时间线展示 C 源码的增删](docs/images/timeline.png)

## 安装与体验

1. 在 [GitHub Releases](https://github.com/sanda-tt/agentcode-live/releases) 下载 VSIX。打开 VS Code 的「扩展 → … → 从 VSIX 安装」。需要 VS Code 1.100 或更新版本。体验当前源码中的功能，可在仓库根目录运行 `npm ci` 和 `npm run package`。
2. 打开受信任的本地目录，点击左侧 **AgentCode Live**。直接让 Agent 修改代码，或单独打开 [C 示例](examples/c-demo)。
3. 从活动视图工具栏或命令面板打开 **实时观看代码变更**。若用示例，在仓库根目录执行 `node examples/play-demo.mjs`。时间线会跟随符合筛选条件的文件变化，并保留较早的事件供回看。

自动跟随可更新后台编辑器，手动编辑优先。即时模式在实际文件上显示高亮，动态预览在只读视图中播放单次差异。时间线也支持连续播放历史。点击某条事件或拖动进度条可离开实时观看，查看历史版本。光标与逐行变化来自记录的快照，并遵循系统的减少动画设置。

光标移动和分步展开的视觉灵感来自 [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors) 和 [Joel Califa 的 Swarm](https://califa.github.io/swarm-site/)。

[动态预览实录](docs/images/cursor-demo.gif)展示 C 示例的创建、修改、重命名和删除。[原生编辑器演示](docs/images/live-demo.gif)展示文件树和编辑器高亮。

## Agent 接入

- **普通 Codex 扩展或 CLI**直接使用观察模式。活动中的磁盘事件标记为「未知」，已有扩展的私有会话无需改动。
- **托管 Codex**由本扩展开启独立 App Server，会显示原生任务轮次、命令状态、文件差异和轮次差异更新。[Codex 接入指南](docs/codex.zh-CN.md)
- **DeepSeek Harness**通过原生 Cordis 插件将工具开始、工具结果和会话状态推送到 VS Code。DSH Web 的会话内也有「文件活动」页，实时显示原生文件工具结果。[DSH 安装与排查](docs/dsh.zh-CN.md)

## 设置

打开命令面板，运行「AgentCode Live: 选择扩展语言」或 **AgentCode Live: Choose Extension Language**。可选「跟随 VS Code」「English」或「简体中文」，重载窗口后生效。也可以在用户设置中修改 `agentcodeLive.language`。命令名称和设置标签跟随 [VS Code 显示语言](https://code.visualstudio.com/docs/configure/locales)，「文件活动」页跟随 DSH Web 的界面语言。

| 设置 | 默认值 |
| --- | --- |
| `agentcodeLive.language` | `auto`，也可设为 `en` 或 `zh-CN` |
| `agentcodeLive.enabled` | 开启工作区监听 |
| `agentcodeLive.follow` | 关闭自动跟随 |
| `agentcodeLive.mode` | `instant`，设为 `cinematic` 可开启动态跟随 |
| `agentcodeLive.animationLinesPerSecond` | 40 |
| `agentcodeLive.addedColor` | 使用 VS Code 主题色，可填十六进制颜色覆盖 |
| `agentcodeLive.history` | 开启本地持久化 |
| `agentcodeLive.maxHistoryMiB` | 24 MiB，最多保留 3,000 条记录 |
| `agentcodeLive.maxFileKiB` | 每个 UTF-8 文件 256 KiB |
| `agentcodeLive.ignore` | 附加 gitignore 风格忽略规则 |
| `agentcodeLive.codexExecutable` | PATH 中的 `codex` |

## 排查与限制

- 用「新建观察会话」切换记录范围。暂停实时视图会冻结活动树和跟随。记录继续，Agent 也继续运行。
- 历史保存在工作区对应的本地 VS Code 存储中，可能包含源码和差异。关闭历史设置停止后续持久化。用「清除本地历史」删除已有记录。关闭持久化时，当前窗口仍可查看有容量上限的临时记录。
- 连续快速写入可能合并为一次快照。基线缺失时只显示首次读到的文件状态。磁盘上的外部重命名根据同批次的唯一相同内容配对推断，界面会注明。
- 看不到变更时检查工作区信任、本地路径、文件大小、UTF-8 编码和忽略规则。依赖、产物、常见凭据文件和符号链接默认排除。查看「输出 → AgentCode Live」定位连接和监听问题。
- 历史导出和 Marketplace 分发属于后续版本。

[架构（英文）](docs/architecture.md) · [验证结果（英文）](docs/verification.md) · [贡献指南（英文）](CONTRIBUTING.md) · [MIT 许可证](LICENSE)
