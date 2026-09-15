export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
export interface ExecOptions {
    /** Complete child environment (not merged with process.env). Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeoutMs?: number;
}
/** Run a program with arguments (no shell) and capture the outcome. Never throws on non-zero exit. */
export type Exec = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;
/**
 * Plain `child_process.spawn` wrapper. A program that cannot be started, dies from a
 * signal or times out yields code 127; stdout/stderr keep their trailing newline.
 */
export declare const realExec: Exec;
