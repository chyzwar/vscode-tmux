/** Remove VS Code / Electron / snap specifics so the daemon and its children see a normal desktop env. */
export declare function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Locate a `node` binary the way the user's shell would (nodenv/nvm shims), falling back to Electron-as-node. */
export declare function resolveNode(env: NodeJS.ProcessEnv, electronPath: string): {
    cmd: string;
    env: NodeJS.ProcessEnv;
};
export interface SpawnResult {
    method: 'systemd-run' | 'detached';
    command: string;
}
/**
 * Start the daemon outside the extension host's lifetime. Prefer a transient
 * systemd user unit (clean environment, survives VS Code exiting); fall back
 * to a detached child with a scrubbed environment.
 */
export declare function spawnDaemon(cliJs: string, baseEnv: NodeJS.ProcessEnv, electronPath: string, log: (s: string) => void): SpawnResult;
