import { execa } from 'execa';

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

const DEFAULT_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 2_000;

/**
 * execa with the daemon's conventions: a program that cannot be started, dies
 * from a signal or times out yields code 127 (its reason in `stderr` when the
 * program itself wrote nothing); stdout/stderr keep their trailing newline.
 */
export const realExec: Exec = async (cmd, args, opts = {}) => {
  const r = await execa(cmd, args, {
    reject: false,
    env: opts.env ?? process.env,
    extendEnv: false,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    forceKillAfterDelay: KILL_GRACE_MS,
    stdin: 'ignore',
    stripFinalNewline: false,
    encoding: 'utf8',
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  if (r.exitCode !== undefined) return { code: r.exitCode, stdout, stderr };
  return { code: 127, stdout, stderr: stderr || r.shortMessage || `${cmd} failed to run` };
};
