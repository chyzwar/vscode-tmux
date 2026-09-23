# VS Code Tmux — Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove focus(VS Code A) → Ghostty shows tmux session A, focus(B) → session B, and `vscode file:line:col` from a terminal of A opens the file in VS Code window A.

**Architecture:** A Node/TypeScript daemon owns a dedicated tmux server (one session per workspace, one window per tab) and one Ghostty instance running a single tmux client; it switches that client with `switch-client`. A VS Code extension reports window focus and identity over a Unix socket (NDJSON) and opens files on request. A `vscode` CLI in every tmux session sends open requests to the daemon.

**Tech Stack:** Node 22, TypeScript 5 (strict), yarn 4 workspaces (node-modules linker), esbuild bundles, vitest, VS Code extension API 1.90+, tmux 3.2a, Ghostty 1.3.1, xdotool.

**Spec:** `docs/adr/0001-session-backend-and-presentation.md` plus the approved plan at `~/.claude/plans/i-want-to-build-ethereal-map.md` (copied into `docs/superpowers/specs/2026-09-14-vscode-tmux-design.md`).

## Global Constraints

- Daemon and CLI use only Node built-ins at runtime (`node:net`, `node:child_process`, `node:crypto`, `node:fs`, `node:path`, `node:os`).
- tmux server name: `vscode-tmux`; config: `config/tmux.conf` installed to `~/.config/vscode-tmux/tmux.conf`.
- Ghostty instance: `--class=dev.vscodetmux.Ghostty --gtk-single-instance=true --config-file=~/.config/vscode-tmux/ghostty.conf`.
- Socket path: `/run/user/<uid>/vscode-tmux.sock`. State dir: `~/.local/state/vscode-tmux/`.
- Session name: `<slug>-<workspaceId[0:8]>`; targets always use `=` exact prefix.
- Session env: `VSCODE_TMUX_WORKSPACE_ID`, `VSCODE_TMUX_WORKSPACE`, `VSCODE_TMUX_SOCKET`.
- Protocol: newline-delimited JSON; every request carries `id`; responses are `result` with the same `id` (historical note: `openResult` existed until the zod schemas in `packages/protocol/src/messages.ts` made `result {data:{title}}` the reply to `openRequest`).
- Commands exposed by the extension: `VS Code Tmux: Create Terminal`, `VS Code Tmux: Show Session`.
- Every external process call goes through an injectable `Exec` so unit tests never spawn tmux/ghostty/xdotool.

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `packages/protocol/{package.json,tsconfig.json,src/index.ts}`, `packages/daemon/{package.json,tsconfig.json,build.mjs}`, `packages/extension/{package.json,tsconfig.json,build.mjs}`

**Produces:** `yarn build`, `yarn test`, `yarn typecheck` at the root.

- [ ] Root `package.json` with `"workspaces": ["packages/*"]`, scripts `build` (runs each package build), `test` (`vitest run`), `typecheck` (`tsc -b`), devDependencies: `typescript`, `vitest`, `esbuild`, `@types/node`.
- [ ] `tsconfig.base.json`: `strict`, `module: NodeNext`, `target: ES2022`, `moduleResolution: NodeNext`, `types: ["node"]`.
- [ ] `yarn install`; `yarn test` runs (0 tests) and `yarn typecheck` passes.
- [ ] Commit: `chore: scaffold yarn workspaces`.

### Task 2: Protocol package (NDJSON codec + message types)

**Files:**
- Create: `packages/protocol/src/index.ts`, `packages/protocol/src/ndjson.ts`
- Test: `packages/protocol/test/ndjson.test.ts`

**Produces:**
```ts
export type Message =
  | { type: 'hello'; id: string; workspaceId: string; folder: string; workspaceFile?: string; name: string; extHostPid: number; vscodePid?: number; focused: boolean }
  | { type: 'focus'; workspaceId: string; focused: boolean }
  | { type: 'createTerminal'; id: string; workspaceId: string; name?: string; cwd?: string; command?: string[] }
  | { type: 'showSession'; id: string; workspaceId: string }
  | { type: 'open'; id: string; workspaceId?: string; cwd: string; target: string }
  | { type: 'list'; id: string } | { type: 'status'; id: string }
  | { type: 'openRequest'; id: string; path: string; line?: number; col?: number }
  | { type: 'openResult'; id: string; ok: boolean; title?: string; error?: string }
  | { type: 'result'; id: string; ok: boolean; data?: unknown; error?: string };
export function encode(msg: Message): string;            // JSON + "\n"
export class NdjsonDecoder { push(chunk: Buffer | string): Message[] } // buffers partial lines, skips invalid JSON
```

- [ ] Test: a single line decodes; two lines in one chunk decode to two; a line split across chunks decodes once complete; invalid JSON line is skipped and later lines still decode.
- [ ] Run `yarn vitest run packages/protocol` → fails (module missing).
- [ ] Implement `ndjson.ts` (string buffer, split on `\n`, `JSON.parse` in try/catch) and `index.ts` types.
- [ ] Tests pass. Commit `feat(protocol): ndjson codec and message types`.

### Task 3: Daemon pure modules — ids, target, exec

**Files:**
- Create: `packages/daemon/src/ids.ts`, `packages/daemon/src/target.ts`, `packages/daemon/src/exec.ts`, `packages/daemon/src/paths.ts`
- Test: `packages/daemon/test/ids.test.ts`, `packages/daemon/test/target.test.ts`

**Produces:**
```ts
// ids.ts
export function folderWorkspaceId(fsPath: string, ino: number | bigint): string; // md5(fsPath + String(ino))
export function workspaceFileId(fsPath: string): string;                         // md5(fsPath)
export async function computeWorkspaceId(p: string): Promise<string>;           // stat → dir ? folder : file rule
export function slugify(name: string): string;                                   // [^A-Za-z0-9_-] → '-', collapse, trim, lowercase
export function sessionNameFor(folder: string, workspaceId: string): string;    // `${slugify(basename)}-${workspaceId.slice(0,8)}`
// target.ts
export interface Target { path: string; line?: number; col?: number }
export function parseTarget(target: string, cwd: string): Target;
// exec.ts
export interface ExecResult { code: number; stdout: string; stderr: string }
export type Exec = (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; cwd?: string }) => Promise<ExecResult>;
export const realExec: Exec;
// paths.ts
export function socketPath(): string;  // /run/user/<uid>/vscode-tmux.sock
export function stateDir(): string;    // ~/.local/state/vscode-tmux
export function configDir(): string;   // ~/.config/vscode-tmux
```

- [ ] ids test: `folderWorkspaceId('/home/raziel/MyProjects/email-automation', 21020220) === '4e830601b1054e256ccbde75e89e77e3'` (verified real value); `computeWorkspaceId(tmpdir)` equals `folderWorkspaceId(tmpdir, stat.ino)`; `sessionNameFor('/x/My Project.v2', 'abcdef0123')` → `my-project-v2-abcdef01`.
- [ ] target test: `parseTarget('src/a.ts', '/w')` → `{path:'/w/src/a.ts'}`; `'src/a.ts:120'` → line 120; `'src/a.ts:120:8'` → line, col; `'.'` → `{path:'/w'}`; absolute path kept; `'a.ts:'` → `{path:'/w/a.ts'}`; `'a.ts:x'` → path `/w/a.ts:x` (non-numeric suffix is part of the name).
- [ ] Run → fail; implement; pass. Commit `feat(daemon): workspace ids, target parsing, exec`.

### Task 4: tmux backend

**Files:**
- Create: `packages/daemon/src/backend/types.ts`, `packages/daemon/src/backend/tmux.ts`, `config/tmux.conf`
- Test: `packages/daemon/test/tmux.test.ts` (fake `Exec` recording calls and returning canned stdout)

**Produces:**
```ts
export interface Tab { id: string; index: number; name: string; cwd: string; active: boolean; command: string }
export interface Client { tty: string; termname: string; control: boolean; session: string; pid: number }
export interface SessionBackend {
  ensureServer(): Promise<void>;
  hasSession(name: string): Promise<boolean>;
  createSession(o: { name: string; cwd: string; env: Record<string, string>; firstTabName: string }): Promise<void>;
  listTabs(session: string): Promise<Tab[]>;
  newTab(session: string, o: { name: string; cwd: string; command?: string[] }): Promise<Tab>;
  listClients(): Promise<Client[]>;
  switchClient(tty: string, session: string): Promise<void>;
  listSessions(): Promise<string[]>;
}
export class TmuxBackend implements SessionBackend {
  constructor(o: { exec: Exec; socketName: string; configPath: string; env: NodeJS.ProcessEnv });
  attachCommand(session: string): string[]; // ['tmux','-L',..,'-f',..,'new-session','-A','-s',session]
}
```
tmux invocations (all prefixed `tmux -L <socketName>`; `-f <configPath>` only on `start-server`/`new-session`):
- `ensureServer`: `start-server` (with `-f`).
- `hasSession`: `has-session -t =NAME` → code 0.
- `createSession`: `new-session -d -s NAME -n FIRST -c CWD -e K=V...` (with `-f`).
- `listTabs`: `list-windows -t =S -F '#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}\t#{pane_current_path}\t#{pane_current_command}'`.
- `newTab`: `new-window -t =S: -n NAME -c CWD -P -F '#{window_id}' [-- cmd...]` then `listTabs` to return the Tab.
- `listClients`: `list-clients -F '#{client_tty}\t#{client_termname}\t#{client_control_mode}\t#{client_session}\t#{client_pid}'`.
- `switchClient`: `switch-client -E -c TTY -t =S`.
- `listSessions`: `list-sessions -F '#{session_name}'` (code 1 with "no server" → `[]`).

- [ ] Tests: argv of each call recorded by the fake exec; parsing of tab-separated `list-windows`/`list-clients` output including a control client; `hasSession` false on non-zero exit; `listSessions` empty when server absent.
- [ ] `config/tmux.conf` written (see spec: `exit-empty off`, `destroy-unattached off`, `detach-on-destroy off`, `mouse on`, status top with pill formats, `automatic-rename off`, `allow-rename off`, `set-titles on`, `default-terminal tmux-256color`, `terminal-features 'xterm-ghostty:RGB'`, `extended-keys on`, `set-clipboard on`, `focus-events on`, `escape-time 10`, `history-limit 50000`, `bind -n M-1..9 select-window -t :N`, `bind -n M-t run-shell 'vscode-tmux new'`).
- [ ] Commit `feat(daemon): tmux backend and config`.

### Task 5: Ghostty presenter

**Files:**
- Create: `packages/daemon/src/presenter/types.ts`, `packages/daemon/src/presenter/ghostty.ts`, `config/ghostty.conf`
- Test: `packages/daemon/test/ghostty.test.ts`

**Produces:**
```ts
export interface Presenter { show(session: string): Promise<void>; ensureVisible(): Promise<void> }
export function pickClient(clients: Client[]): Client | undefined; // non-control, prefer termname xterm-ghostty
export class GhosttyPresenter implements Presenter {
  constructor(o: { backend: SessionBackend; spawn: (cmd: string, args: string[], env: NodeJS.ProcessEnv) => void; env: NodeJS.ProcessEnv; configPath: string; appClass: string; lobbySession: string; sleep?: (ms: number) => Promise<void>; timeoutMs?: number });
}
```
`show(session)`: `ensureServer`; ensure lobby session exists; find client via `pickClient(listClients())`; if none, `spawn('ghostty', ['--class=...','--gtk-single-instance=true','--config-file=...', `--command=${attachCommand(lobby).join(' ')}`], env)` and poll `listClients` every 100 ms up to `timeoutMs` (default 5000); then `switchClient(tty, session)` unless the client already shows it.

- [ ] Tests: `pickClient` prefers `xterm-ghostty`, ignores control clients, returns undefined when none; `show` launches Ghostty once when no client and switches after a client appears (fake backend with mutable client list, fake sleep); `show` does not spawn when a client exists; skips switch if `client.session === session`.
- [ ] `config/ghostty.conf`: `title = VS Code Tmux`, `confirm-close-surface = false`, `window-show-tab-bar = never`, `keybind = alt+one..nine=unbind` for digits 1–9 (`alt+1`, `alt+digit_1` etc.), `keybind = ctrl+shift+t=unbind`, `keybind = ctrl+shift+n=unbind`.
- [ ] Commit `feat(daemon): ghostty presenter`.

### Task 6: Registry, state, opener

**Files:**
- Create: `packages/daemon/src/registry.ts`, `packages/daemon/src/state.ts`, `packages/daemon/src/opener.ts`
- Test: `packages/daemon/test/opener.test.ts`, `packages/daemon/test/state.test.ts`

**Produces:**
```ts
export interface WorkspaceRecord { workspaceId: string; folder: string; workspaceFile?: string; name: string; sessionName: string }
export interface Connection { send(msg: Message): void; request(msg: Message, timeoutMs?: number): Promise<Message> }
export class Registry { upsert(r: WorkspaceRecord): void; get(id: string): WorkspaceRecord | undefined; attach(id: string, c: Connection): void; detach(c: Connection): void; connection(id: string): Connection | undefined; all(): WorkspaceRecord[] }
export interface State { workspaces: Record<string, { folder: string; workspaceFile?: string; name: string; sessionName: string; tabs: { name: string; cwd: string; command?: string[] }[] }> }
export function loadState(file: string): State; export function saveState(file: string, s: State): void; // atomic write via tmp + rename
export class Opener {
  constructor(o: { registry: Registry; exec: Exec; codeCommand?: string; xdotoolAvailable: () => Promise<boolean> });
  open(o: { workspaceId?: string; cwd: string; target: string }): Promise<{ via: 'extension' | 'code-cli' | 'code-cli-fallback'; title?: string }>;
}
```
`open`: parse target; if workspaceId known and a connection exists → `request({type:'openRequest', id, path, line, col})` → on `ok` with `title`, run `xdotool search --name ^<escaped title>$` and `xdotool windowactivate --sync <id>` when available, else `code <folder> --goto <path>:<line>:<col>`; if no connection → `code <folder or workspaceFile> --goto ...`; if no workspaceId → `code --goto ...`.

- [ ] Tests: extension path with xdotool (records regex-escaped title and windowactivate), extension path without xdotool falls back to `code <folder> --goto`, disconnected workspace uses code CLI with the folder, unknown workspace uses plain `code --goto`, `.` target opens the folder (`code <folder>` or focus only).
- [ ] state test: round trip, missing file → empty state.
- [ ] Commit `feat(daemon): registry, state, opener`.

### Task 7: Daemon server and main

**Files:**
- Create: `packages/daemon/src/server.ts`, `packages/daemon/src/daemon.ts`, `packages/daemon/src/main.ts`, `packages/daemon/src/log.ts`, `packages/daemon/bin/vscode`
- Test: `packages/daemon/test/server.test.ts` (in-memory connection objects, fake backend/presenter/opener)

**Produces:** `class DaemonServer { constructor(deps); handle(conn, msg): Promise<void>; listen(socketPath): Promise<void> }` and `main.ts` subcommands `daemon | open <target> | list | status | new [name]`.

Behavior:
- `hello`: registry.upsert; `ensureServer`; if `!hasSession(sessionName)` → `createSession({name, cwd: folder, env, firstTabName: 'Shell'})`; state updated and saved; reply `result {sessionName, created}`; if `focused` → `presenter.show`.
- `focus {focused:true}`: debounce 50 ms; `presenter.show(sessionName)`; errors logged, not thrown.
- `createTerminal`: `newTab(session, {name: name ?? 'Terminal N', cwd: cwd ?? folder, command})`; `select-window` on it; save state; `presenter.show`.
- `showSession`: `presenter.show`.
- `open`: `opener.open(...)` → `result`.
- `list`: workspaces with sessions and tabs; `status`: socket, tmux server up, ghostty client present.
- Connection close → `registry.detach`.
- `listen`: remove stale socket if connect fails, `net.createServer`, chmod 600.
- `main daemon`: single-instance check by connecting to the socket first; log to `~/.local/state/vscode-tmux/daemon.log`; ignore SIGHUP.
- `main open|list|status|new`: connect, send request, print reply, exit code 1 on error; `open` without a running daemon → `code --goto` fallback.
- `bin/vscode`: `#!/bin/sh` → `exec vscode-tmux open "$@"`.

- [ ] Tests: hello creates session once (second hello reuses), focus triggers presenter.show with the right session, createTerminal appends tab and saves state, open routes via opener.
- [ ] esbuild bundle `dist/cli.js` (banner `#!/usr/bin/env node`, platform node, format cjs, external none; protocol bundled).
- [ ] Commit `feat(daemon): server, cli, daemon entry`.

### Task 8: VS Code extension

**Files:**
- Create: `packages/extension/src/{extension.ts,identity.ts,client.ts,spawn.ts,title.ts}`, `packages/extension/package.json` (contributes commands, activationEvents `onStartupFinished`, `engines.vscode ^1.90.0`), `packages/extension/build.mjs` (bundles `dist/extension.js` and copies `../daemon/dist/cli.js` to `dist/cli.js`)
- Test: `packages/extension/test/{identity.test.ts,title.test.ts}`

**Produces:**
```ts
export function identityFromStorageUri(storageUriFsPath: string | undefined, folder: string | undefined, workspaceFile: string | undefined, name: string): { workspaceId: string; folder: string; workspaceFile?: string; name: string } | undefined;
export function predictTitle(template: string, vars: Record<string, string>): string; // replaces ${x}, collapses empty separators
export class DaemonClient { connect(): Promise<void>; send(m); request(m): Promise<Message>; onRequest(handler: (m: Message) => Promise<Message>): void; onDisconnect(cb): void }
export function spawnDaemon(cliJs: string, log: (s: string) => void): void; // systemd-run --user first, fallback detached spawn with scrubbed env
```
`extension.ts` `activate`: identity → if undefined, return; client connect (spawn on ENOENT/ECONNREFUSED, retry 10×200 ms); `hello` with `focused: vscode.window.state.focused`; `onDidChangeWindowState` → `focus`; `onRequest('openRequest')` → `openTextDocument` + `showTextDocument({selection, preview:false})` + `revealRange(InCenter)` → reply `openResult {ok:true, title: predictTitle(window.title setting, vars)}`; commands `vscode-tmux.createTerminal` (input box for name) and `vscode-tmux.showSession`; reconnect loop on disconnect.

- [ ] identity test: `.../workspaceStorage/4e83.../pub.ext` + folder → id `4e83...`; undefined storageUri → undefined.
- [ ] title test: default template with `dirty=''`, `activeEditorShort='App.tsx'`, `rootName='project-a'`, `profileName=''`, `appName='Visual Studio Code'` → `App.tsx - project-a - Visual Studio Code`.
- [ ] Build with esbuild; package with `vsce package` (`yarn dlx @vscode/vsce`) → `.vsix`.
- [ ] Commit `feat(extension): focus reporting, identity, open handler, commands`.

### Task 9: install.bash, README, e2e checklist

**Files:**
- Create: `install.bash`, `README.md`, `docs/e2e.md`, `docs/superpowers/specs/2026-09-14-vscode-tmux-design.md` (copy of the approved design)

`install.bash` (idempotent, `set -euo pipefail`, flags `--no-vscode-deb`, `--no-apt`):
1. `sudo apt-get install -y tmux xdotool curl` unless `--no-apt`.
2. VS Code deb: if `dpkg -s code` missing and not `--no-vscode-deb`: download `https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64` to a temp file, `sudo apt-get install -y ./code.deb`; warn if `snap list code` succeeds (both `code` binaries exist; PATH decides).
3. Ghostty: if `ghostty` missing, print install hint (snap `ghostty` or ghostty-ubuntu deb) and continue.
4. Node ≥ 22 check; `corepack enable` if `yarn` missing; `yarn install && yarn build`.
5. Symlink `~/.local/bin/vscode-tmux` → `packages/daemon/dist/cli.js` (chmod +x) and `~/.local/bin/vscode` → `packages/daemon/bin/vscode`.
6. Copy `config/tmux.conf` and `config/ghostty.conf` to `~/.config/vscode-tmux/` (no overwrite if exists unless `--force-config`).
7. `code --install-extension packages/extension/*.vsix --force`.
8. Print next steps (reload VS Code windows).

- [ ] README: what it does, architecture diagram, install, usage, limitations, roadmap.
- [ ] `docs/e2e.md`: the six verification steps from the plan with expected observations.
- [ ] Run install.bash on this machine (with `--no-vscode-deb` first if the user has not decided about removing the snap), execute the e2e checklist, record results.
- [ ] Commit `docs: readme, e2e checklist, installer`.
