import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
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

/** Punctuation that ends up glued to a path in compiler and test output: `at foo.ts:1:2)`, `"foo.ts",`. */
const TRAILING = /[)\]}>,;.'"`]+$/;
const LEADING = /^[([{<'"`]+/;

/**
 * Turn what the user clicked into a target, or undefined when it is not a file.
 *
 * `hyperlink` is an OSC 8 destination (tmux `#{mouse_hyperlink}`), which tools
 * like ripgrep emit; it wins when present. `word` is the plain text under the
 * pointer (`#{mouse_word}`), which is the usual case: compilers and test runners
 * print bare `src/foo.ts:42:8`. Anything that does not resolve to an existing
 * file is discarded, so clicking a random word does nothing.
 */
export function parseClickTarget(word: string, hyperlink: string, cwd: string): Target | undefined {
  const text = fromHyperlink(hyperlink) ?? word.trim().replace(LEADING, '').replace(TRAILING, '');
  if (!text) return undefined;
  const expanded = text.startsWith('~/') ? resolve(homedir(), text.slice(2)) : text;
  const target = parseTarget(expanded, cwd);
  if (!existsSync(target.path)) return undefined;
  return target;
}

/** `file:///abs/path`, `vscode://file/abs/path:12:3` and friends; undefined for anything else. */
function fromHyperlink(hyperlink: string): string | undefined {
  const raw = hyperlink.trim();
  if (!raw) return undefined;
  const file = /^file:\/\/[^/]*(\/.*)$/.exec(raw);
  if (file) return decodeURIComponent(file[1]!);
  const vscode = /^vscode(?:-insiders)?:\/\/file(\/.*)$/.exec(raw);
  if (vscode) return decodeURIComponent(vscode[1]!);
  return undefined;
}
