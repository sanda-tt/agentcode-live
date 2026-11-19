# Verification

## Windows 11 · VS Code 1.144.0

| Check | Observed result |
| --- | --- |
| Unit suite | Four passing tests covering line and character differences, metadata deduplication, listener failures, local history persistence, and bridge authentication. |
| Extension Development Host | Real watcher captured a 30-line C file, 10 deleted lines and five replacements. Also verified append, insertion, full rewrite, Windows atomic replacement, external rename and removal, two roots, exclusions, quick writes and disable/re-enable. |
| Real Codex CLI (0.169.1) | Codex wrote its own C file. Observer recorded the actual snapshot with Unknown attribution. |
| Managed Codex | A native App Server turn wrote a separate C file. The extension received native turn completion, a per-file patch and the matching independent disk snapshot. |
| Official DSH (0.2.2-rc.5) | The Web profile loaded the Cordis plugin. Actual DSH tool dispatch wrote disposable C source. Tool start and result reached VS Code. The test restarted the Web process and observed reconnect and disconnect. The packaged bundle was installed, removed and installed again in an isolated profile. |
| Installed VSIX desktop GUI | Installed in a fresh profile. Observed Explorer badges and background follow. Exercised filters, before/after, playback speed, play/pause, timeline slider and native diff. The checked source file contents were identical after playback. |

One 450-file Windows burst completed from scripted writes through observation in 717 ms. During that interval, the extension-host process consumed 656 ms of CPU time and its RSS increased by about 5.3 MiB. These are one fixture's whole-process measurements.

The DSH fixture invoked the real Cordis tool pipeline without an LLM. Model-driven DSH execution still requires a signed-in or configured provider. Codex testing used the CLI and the managed App Server. The existing VS Code Codex extension's private protocol is outside this integration.
