# Verification

## Windows 11 · VS Code 1.144.0

| Check | Observed result |
| --- | --- |
| Unit suite | Six passing tests covering line and character differences, metadata deduplication, listener failures, local history persistence, bridge authentication, and the DSH file activity projection. |
| Extension Development Host | Real watcher captured a 30-line C file, 10 deleted lines and five replacements. Also verified append, insertion, full rewrite, Windows atomic replacement, external rename and removal, two roots, exclusions, quick writes and disable/re-enable. |
| Real Codex CLI (0.169.1) | Codex wrote its own C file. Observer recorded the actual snapshot with Unknown attribution. |
| Managed Codex | A native App Server turn wrote a separate C file. The extension received native turn completion, a per-file patch and the matching independent disk snapshot. |
| Official DSH (0.2.2-rc.5) | The Web profile loaded the Cordis plugin. Actual DSH tool dispatch wrote disposable C source. Tool start and result reached VS Code. The test restarted the Web process and observed reconnect and disconnect. The packaged bundle was installed, removed and installed again in an isolated profile. |
| Model-driven DSH task | The official DSH headless profile ran a real model turn against Qwen3-4B Q4_K_M served by llama.cpp b12549 on loopback. DSH's built-in `write` created `model_real.c` in an isolated workspace. The task exited successfully, the file contents matched, and AgentCode Live's bridge received both native tool lifecycle events for the same session. |
| Installed VSIX desktop GUI | Installed in a fresh profile. Observed Explorer badges and background follow. Exercised filters, before/after, playback speed, play/pause, timeline slider and native diff. The checked source file contents were identical after playback. |
| Installed DSH Web browser GUI | The official Web client loaded the shipped bundle from a clean profile. DSH's built-in write tool first created a C file. A second invocation modified the file while the [File activity tab](images/dsh-file-activity.png) was open, and the new row appeared without a refresh. |
| GitHub Actions | The first [Windows CI run](https://github.com/sanda-tt/agentcode-live/actions/runs/44583562253) passed installation, unit tests, the VS Code Extension Development Host suite, and both packaging steps. Both downloaded CI packages identify version 0.1.1. |

The Extension Development Host suite also passed with the downloaded minimum VS Code test version 1.100.3. The [Windows replay](images/live-demo.gif) was recorded from a real installation in a disposable C workspace.

One 450-file Windows burst completed from scripted writes through observation in 717 ms. During that interval, the extension-host process consumed 656 ms of CPU time and its RSS increased by about 5.3 MiB. These are one fixture's whole-process measurements.

The repeatable Cordis and browser fixtures invoke the real DSH tool pipeline directly. The separate headless acceptance run uses local Qwen inference. Codex testing used the CLI and the managed App Server. The existing VS Code Codex extension's private protocol is outside this integration.
