import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, saveState, type State } from '../src/state.js';

describe('state', () => {
  it('returns an empty state when the file is missing', () => {
    expect(loadState('/nonexistent/vst/state.json')).toEqual({ version: 1, workspaces: {} });
  });
  it('round-trips and writes pretty JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vst-state-'));
    const file = join(dir, 'nested', 'state.json');
    const s: State = {
      version: 1,
      workspaces: {
        abc: { folder: '/p', name: 'p', sessionName: 'p-abc', tabs: [{ name: 'Shell', cwd: '/p' }, { name: 'Server', cwd: '/p', command: ['npm', 'run', 'dev'] }] },
      },
    };
    saveState(file, s);
    expect(loadState(file)).toEqual(s);
    expect(readFileSync(file, 'utf8')).toContain('\n  "workspaces"');
  });
  it('ignores a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vst-state-'));
    const file = join(dir, 'state.json');
    require('node:fs').writeFileSync(file, '{not json');
    expect(loadState(file)).toEqual({ version: 1, workspaces: {} });
  });
});
