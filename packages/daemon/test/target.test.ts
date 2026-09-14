import { describe, expect, it } from 'vitest';
import { parseTarget } from '../src/target.js';

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
