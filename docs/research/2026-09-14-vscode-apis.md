# VS Code APIs for window focus, workspace identity, and targeted file open

Sources: `src/vscode-dts/vscode.d.ts`, `src/vs/platform/workspaces/node/workspaces.ts`, `src/vs/platform/windows/electron-main/windowsMainService.ts`, `windowsFinder.ts`, `windowImpl.ts`, `nativeHostMainService.ts`, `extHostWindow.ts`, `mainThreadWindow.ts`, `windowTitle.ts`, `titlebarPart.ts`, `resources/linux/snap/electron-launch`, release notes 1.89, Mutter `window.c`. Local: VS Code 1.132.0 snap, `~/.config/Code/User/workspaceStorage`.

## Focus

```ts
interface WindowState { readonly focused: boolean; readonly active: boolean }
window.state: WindowState
window.onDidChangeWindowState: Event<WindowState>
```
- `focused` = OS-level focus of this window (or a floating editor window it owns), derived from Electron main-process focus/blur events. Per window: each window has its own extension host.
- No debounce; duplicates suppressed. Initial `window.state` is a placeholder `{focused: true, active: true}` until an async roundtrip; treat the first event as authoritative.
- `active` (finalized 1.89) = user interaction within the last 10 s.
- Known issues: #149487 (i3/X11 WM switches not reported), #240596 (native Wayland multi-window). The snap always runs XWayland (`electron-launch` appends `--ozone-platform=x11`).

## Identity

`workspaces.ts` (comment: "IDENTIFIERS HAVE TO REMAIN STABLE"):
- single folder on Linux: `md5(folder.fsPath + String(stat.ino))`
- `.code-workspace` file: `md5(configPath)` (case preserved on Linux)
Verified locally: `md5("/home/raziel/MyProjects/email-automation" + "21020220") == 4e830601b1054e256ccbde75e89e77e3` matches the `workspaceStorage` directory. `context.storageUri` path = `<userData>/User/workspaceStorage/<id>/<publisher.name>`. VS Code never opens the same folder/workspace twice (`findWindowOnWorkspaceOrFolder` focuses the existing window), so the id is unique per window. `env.sessionId` changes per launch; `workspace.name` is not unique.

## Opening a file in a specific window from outside

- `code <exact-folder-or-.code-workspace> --goto <file>:<line>:<col>` (no `-r`, no `-n`): `findWindowOnWorkspaceOrFolder` requires exact URI equality, files open in that window, then `window.focus()`. With `-r` and no match the last active window's workspace would be replaced; avoid.
- Files only (`code -g f:10`): "window whose folder contains the file" heuristic, then last active window.
- `vscode://file/...` URIs use the same file heuristic; `vscode://<ext-id>/...` goes to the active window (not targetable).
- Inside the extension: `window.showTextDocument(uri, {selection, preview})` + `editor.revealRange(range, InCenter)`.
- Raising: `workbench.action.focusWindow` (internal) → Electron `win.focus()`; VS Code has no xdg-activation/X11 timestamp handling. Mutter `meta_window_activate_full`: a timestamp older than the last user interaction → "demands attention" toast instead of a raise; **timestamp 0 is replaced with the current time and passes**, which is what `xdotool windowactivate`/`wmctrl -ia` send. All VS Code windows share the main process PID, so match X windows by title.
- Proposed API `window.nativeHandle` exists only as a proposal.

## Titles

`window.title` is window-scoped (settable at workspace level). Variables: `activeEditorShort/Medium/Long`, `rootName`, `rootPath`, `folderName`, `folderPath`, `appName`, `dirty`, `separator`, etc. Default: `${dirty}${activeEditorShort}${separator}${rootName}${separator}${profileName}${separator}${appName}` → e.g. `App.tsx - project-a - Visual Studio Code`. Undocumented command `registerWindowTitleVariable(name, contextKey)` lets an extension inject `${var}` via `setContext` (internal; may change). The native OS title equals the rendered template.

## Extension host

Node.js utility process: `net`, `fs`, `child_process` available. Env inherits the renderer's shell env plus `VSCODE_PID` (main PID), `VSCODE_IPC_HOOK`; snap adds `GTK_PATH`, `GIO_MODULE_DIR`, `LOCPATH`, `*_VSCODE_SNAP_ORIG` and may change `XDG_RUNTIME_DIR` → compute socket paths from the uid, and scrub the env before spawning the daemon/terminal.

## `vscode.env`

`appName`, `appRoot`, `appHost`, `machineId`, `sessionId`, `shell`, `remoteName`, `uiKind`. Nothing exposes a window id or PID.
