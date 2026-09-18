import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseClickTarget, parseTarget } from '../src/target.js';

describe('parseTarget', () => {
  it('resolves relative paths against cwd', () => {
    expect(parseTarget('src/a.ts', '/w')).toEqual({ path: '/w/src/a.ts' });
  });
  it('parses line', () => {
    expect(parseTarget('src/a.ts:120', '/w')).toEqual({ path: '/w/src/a.ts', line: 120 });
  });
  it('parses line and column', () => {
    expect(parseTarget('src/a.ts:120:8', '/w')).toEqual({ path: '/w/src/a.ts', line: 120, col: 8 });
  });
  it('treats "." as the cwd', () => {
    expect(parseTarget('.', '/w')).toEqual({ path: '/w' });
  });
  it('keeps absolute paths', () => {
    expect(parseTarget('/etc/hosts:3', '/w')).toEqual({ path: '/etc/hosts', line: 3 });
  });
  it('ignores a trailing colon', () => {
    expect(parseTarget('a.ts:', '/w')).toEqual({ path: '/w/a.ts' });
  });
  it('keeps non-numeric suffixes as part of the name', () => {
    expect(parseTarget('a.ts:x', '/w')).toEqual({ path: '/w/a.ts:x' });
  });
  it('accepts the #L form used by some tools', () => {
    expect(parseTarget('a.ts#L12', '/w')).toEqual({ path: '/w/a.ts', line: 12 });
  });
});

describe('parseClickTarget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vst-click-'));
  const file = join(dir, 'app.ts');
  writeFileSync(file, 'x');

  it('takes a bare path printed by a compiler', () => {
    expect(parseClickTarget('app.ts:42:8', '', dir)).toEqual({ path: file, line: 42, col: 8 });
  });

  it('strips the punctuation that output glues on', () => {
    expect(parseClickTarget('(app.ts:42)', '', dir)).toEqual({ path: file, line: 42 });
    expect(parseClickTarget('"app.ts",', '', dir)).toEqual({ path: file });
  });

  it('prefers an OSC 8 hyperlink over the word under the pointer', () => {
    expect(parseClickTarget('nonsense', `file://host${file}#L7`, dir)).toEqual({ path: file, line: 7 });
    expect(parseClickTarget('nonsense', `vscode://file${file}:3:4`, dir)).toEqual({ path: file, line: 3, col: 4 });
  });

  it('expands ~ against the home directory', () => {
    const rel = relative(homedir(), file);
    if (!rel.startsWith('..')) expect(parseClickTarget(`~/${rel}`, '', '/nowhere')).toEqual({ path: file });
  });

  it('ignores a word that is not an existing file, so clicking prose does nothing', () => {
    expect(parseClickTarget('the', '', dir)).toBeUndefined();
    expect(parseClickTarget('missing.ts:3', '', dir)).toBeUndefined();
    expect(parseClickTarget('', '', dir)).toBeUndefined();
  });

  it('ignores hyperlinks that are not files', () => {
    expect(parseClickTarget('', 'https://example.com', dir)).toBeUndefined();
  });
});
