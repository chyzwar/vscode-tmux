"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnDaemon = spawnDaemon;
const node_child_process_1 = require("node:child_process");
const protocol_1 = require("@vscode-tmux/protocol");
/**
 * Start the daemon binary outside the extension host's lifetime. Prefer a transient
 * systemd user unit (clean environment, survives VS Code exiting); fall back to a
 * detached child with a scrubbed environment.
 */
function spawnDaemon(binPath, baseEnv, log) {
    const env = (0, protocol_1.scrubEnv)(baseEnv);
    const unit = `vscode-tmux-${process.getuid?.() ?? 'user'}`;
    const command = `${binPath} daemon`;
    const systemdArgs = ['--user', '--collect', '--quiet', `--unit=${unit}`, `--setenv=PATH=${env.PATH ?? ''}`];
    const systemd = (0, node_child_process_1.spawnSync)('systemd-run', [...systemdArgs, binPath, 'daemon'], { env, encoding: 'utf8', timeout: 5000 });
    if (systemd.status === 0) {
        log(`daemon started via systemd-run (${unit})`);
        return { method: 'systemd-run', command };
    }
    if (/already (exists|loaded|active|running)/i.test(systemd.stderr ?? '')) {
        log(`daemon unit ${unit} already exists (started by another window)`);
        return { method: 'systemd-run', command };
    }
    log(`systemd-run unavailable (${systemd.stderr?.trim() || systemd.error?.message || 'exit ' + systemd.status}); spawning detached`);
    const child = (0, node_child_process_1.spawn)(binPath, ['daemon'], { env, detached: true, stdio: 'ignore' });
    child.unref();
    return { method: 'detached', command };
}
//# sourceMappingURL=spawn.js.map