"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveNode = resolveNode;
exports.spawnDaemon = spawnDaemon;
const node_child_process_1 = require("node:child_process");
const protocol_1 = require("@vscode-tmux/protocol");
/** Locate a `node` binary the way the user's shell would (nodenv/nvm shims), falling back to Electron-as-node. */
function resolveNode(env, electronPath) {
    const shell = env.SHELL || '/bin/bash';
    const probe = (0, node_child_process_1.spawnSync)(shell, ['-lc', 'command -v node'], { env, encoding: 'utf8', timeout: 5000 });
    const node = probe.status === 0 ? probe.stdout.trim().split('\n').pop() : undefined;
    if (node)
        return { cmd: node, env };
    return { cmd: electronPath, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
}
/**
 * Start the daemon outside the extension host's lifetime. Prefer a transient
 * systemd user unit (clean environment, survives VS Code exiting); fall back
 * to a detached child with a scrubbed environment.
 */
function spawnDaemon(cliJs, baseEnv, electronPath, log) {
    const env = (0, protocol_1.scrubEnv)(baseEnv);
    const node = resolveNode(env, electronPath);
    const unit = `vscode-tmux-${process.getuid?.() ?? 'user'}`;
    const systemdArgs = ['--user', '--collect', '--quiet', `--unit=${unit}`, `--setenv=PATH=${env.PATH ?? ''}`];
    if (node.env.ELECTRON_RUN_AS_NODE)
        systemdArgs.push('--setenv=ELECTRON_RUN_AS_NODE=1');
    const systemd = (0, node_child_process_1.spawnSync)('systemd-run', [...systemdArgs, node.cmd, cliJs, 'daemon'], { env, encoding: 'utf8', timeout: 5000 });
    if (systemd.status === 0) {
        log(`daemon started via systemd-run (${unit})`);
        return { method: 'systemd-run', command: `${node.cmd} ${cliJs} daemon` };
    }
    log(`systemd-run unavailable (${systemd.stderr?.trim() || systemd.error?.message || 'exit ' + systemd.status}); spawning detached`);
    const child = (0, node_child_process_1.spawn)(node.cmd, [cliJs, 'daemon'], { env: node.env, detached: true, stdio: 'ignore' });
    child.unref();
    return { method: 'detached', command: `${node.cmd} ${cliJs} daemon` };
}
//# sourceMappingURL=spawn.js.map