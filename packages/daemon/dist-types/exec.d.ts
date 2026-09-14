export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface ExecOptions {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
}
/** Run a program with arguments (no shell) and capture the outcome. Never throws on non-zero exit. */
export type Exec = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;
export declare const realExec: Exec;
