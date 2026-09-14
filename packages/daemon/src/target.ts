import { resolve } from 'node:path';

export interface Target {
  path: string;
  line?: number;
  col?: number;
}

/**
 * Parse `path[:line[:col]]`, `path#Lline`, or `.` into an absolute target.
 * Non-numeric suffixes stay part of the file name.
 */
export function parseTarget(target: string, cwd: string): Target {
  let rest = target.trim();
  if (rest === '' || rest === '.') return { path: resolve(cwd) };

  let line: number | undefined;
  let col: number | undefined;

  const hash = /^(.*)#L(\d+)(?:C(\d+))?$/i.exec(rest);
  if (hash) {
    rest = hash[1]!;
    line = Number(hash[2]);
    if (hash[3]) col = Number(hash[3]);
  } else {
    // strip a trailing ":" (common when copying "file:line:" style output)
    rest = rest.replace(/:+$/, '');
    const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(rest);
    if (m && m[1] !== undefined && (m[2] !== undefined || m[3] !== undefined)) {
      rest = m[1];
      if (m[2] !== undefined) line = Number(m[2]);
      if (m[3] !== undefined) col = Number(m[3]);
    }
  }

  const out: Target = { path: resolve(cwd, rest) };
  if (line !== undefined) out.line = line;
  if (col !== undefined) out.col = col;
  return out;
}
