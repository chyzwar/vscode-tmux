import { execa } from 'execa';

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

export const realExec: Exec = async (cmd, args, opts = {}) => {
  const r = await execa(cmd, args, {
    env: opts.env ?? process.env,
    extendEnv: false,
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 10_000,
    reject: false,
    stdin: 'ignore',
    stripFinalNewline: false,
  });
  return { code: r.exitCode ?? 127, stdout: r.stdout, stderr: r.stderr };
};
