import { spawn } from 'node:child_process';

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
 * Plain `child_process.spawn` wrapper. A program that cannot be started, dies from a
 * signal or times out yields code 127; stdout/stderr keep their trailing newline.
 */
export const realExec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      clearTimeout(term);
      clearTimeout(kill);
      resolve({ code, stdout, stderr });
    };
    let child;
    try {
      child = spawn(cmd, args, { env: opts.env ?? process.env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      stderr = (err as Error).message;
      finish(127);
      return;
    }
    const term = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const kill = setTimeout(() => child.kill('SIGKILL'), timeoutMs + KILL_GRACE_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (err) => {
      if (!stderr) stderr = err.message;
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 127));
  });
