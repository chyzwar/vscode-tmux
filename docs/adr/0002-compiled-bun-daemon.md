# ADR-0002: The daemon ships as a Bun-compiled binary

- Status: accepted (2026-09-15)
- Deciders: project owner
- Target environment at decision time: Ubuntu 22.04 x64, Bun 1.3.11, Node 26.5.0, VS Code 1.132

## Context

The daemon and CLI were an esbuild ESM bundle (`dist/cli.mjs`) run by whatever `node` could be found. That meant: a `#!/usr/bin/env node` shebang resolved through nodenv/nvm shims, the extension probing the user's login shell for `node` and falling back to VS Code's Electron with `ELECTRON_RUN_AS_NODE`, a 1 MB bundle copied into the .vsix, and Node >= 26 as a runtime requirement. Since `install.bash` is the only distribution channel, none of that discovery earns its keep.

Bun's `bun build --compile` produces one self-contained Linux x64 executable from `src/main.ts` in about 0.1 s. Node's single-executable applications need a CJS entry, postject and the same ~100 MB footprint, so if the daemon is compiled at all, Bun is the simpler tool.

Measured before deciding: CLI startup is 60-70 ms under both runtimes (dominated by the daemon round trip), so speed is not a reason. Every Node API the daemon uses (`net` unix sockets, `child_process` detached spawn with raw fds, signals, `fs.stat` bigint inodes, md5) behaves identically under Bun, with one exception below.

## Decision

1. `packages/daemon` builds with `bun build --compile --target=bun-linux-x64` to `dist/vscode-tmux`. `install.bash` installs Bun if missing and copies the binary to `~/.local/bin/vscode-tmux` with an atomic rename. execa was dropped; the daemon has no npm runtime dependencies.
2. The extension only spawns that path (setting `vscode-tmux.daemonPath` overrides it) and no longer ships the daemon inside the .vsix. Node discovery code is gone.
3. Source stays `node:`-API only (no `Bun.*` globals) so `tsc` with `@types/node` and vitest on Node keep working. A vitest smoke test drives the compiled binary as a black box (argv, bind race, socket mode, signals).
4. Bun `net.Server.listen(path)` does not fail with `EADDRINUSE` on a bound unix path: it unlinks the file and binds a new socket, leaving the earlier server on an orphaned inode (verified on 1.3.11; Node 26 raises `EADDRINUSE`). The daemon therefore records the socket inode after binding and polls it; if the file is replaced, the daemon logs and exits 0, and the extension reconnects to the new owner. Under Node the pre-existing `AlreadyRunningError` path handles the same race.

## Consequences

- `~/.local/bin/vscode-tmux` is ~100 MB (the Bun runtime is embedded). Acceptable for an installer-distributed tool.
- Bun is a build requirement and, since 2026-09-15, also the package manager (yarn 4 and corepack were dropped). Node >= 26 remains one for esbuild, tsc, vitest and vsce, which Bun runs with Node.
- The .vsix is not self-contained: without `install.bash` (or the setting) the extension shows an error and stays idle.
- The binary is Linux x64 only; other targets need `--target` changes in the daemon build script.

## Revisit triggers

- Node ships a practical single-executable build for ESM entries.
- Bun changes unix socket listen semantics (the ownership watchdog then becomes redundant but harmless).
- The extension is to be published on the Marketplace as a self-contained package.
