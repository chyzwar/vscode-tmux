export interface SpawnResult {
    method: 'systemd-run' | 'detached';
    command: string;
}
/**
 * Start the daemon binary outside the extension host's lifetime. Prefer a transient
 * systemd user unit (clean environment, survives VS Code exiting); fall back to a
 * detached child with a scrubbed environment.
 */
export declare function spawnDaemon(binPath: string, baseEnv: NodeJS.ProcessEnv, log: (s: string) => void): SpawnResult;
