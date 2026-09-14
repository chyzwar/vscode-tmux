import type { Exec, ExecResult } from '../src/exec.js';

export interface Call {
  cmd: string;
  args: string[];
}

/**
 * Records every invocation and answers with the first matching canned result.
 * `respond` receives the full argv so tests can branch on the tmux subcommand.
 */
export function fakeExec(respond: (cmd: string, args: string[]) => Partial<ExecResult> | undefined = () => undefined) {
  const calls: Call[] = [];
  const exec: Exec = async (cmd, args) => {
    calls.push({ cmd, args });
    const r = respond(cmd, args) ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { exec, calls };
}

export const argsOf = (calls: Call[], sub: string): string[] | undefined =>
  calls.find((c) => c.args.includes(sub))?.args;
