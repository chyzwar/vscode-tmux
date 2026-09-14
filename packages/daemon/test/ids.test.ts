import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeWorkspaceId, folderWorkspaceId, sessionNameFor, slugify, workspaceFileId } from '../src/ids.js';

describe('folderWorkspaceId', () => {
  it('matches the id VS Code uses for workspaceStorage on Linux (md5 of path + inode)', () => {
    // Verified on 2026-09-14 against ~/.config/Code/User/workspaceStorage.
    expect(folderWorkspaceId('/home/raziel/MyProjects/email-automation', 21020220)).toBe(
      '4e830601b1054e256ccbde75e89e77e3',
    );
  });
  it('accepts bigint inodes', () => {
    expect(folderWorkspaceId('/x', 5n)).toBe(folderWorkspaceId('/x', 5));
  });
});

describe('workspaceFileId', () => {
  it('is md5 of the path', () => {
    expect(workspaceFileId('/a/b.code-workspace')).toMatch(/^[0-9a-f]{32}$/);
    expect(workspaceFileId('/a/b.code-workspace')).not.toBe(workspaceFileId('/a/c.code-workspace'));
  });
});

describe('computeWorkspaceId', () => {
  it('uses the inode rule for directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vst-'));
    const { ino } = statSync(dir, { bigint: true });
    expect(await computeWorkspaceId(dir)).toBe(folderWorkspaceId(dir, ino));
  });
  it('uses the path rule for .code-workspace files', async () => {
    expect(await computeWorkspaceId('/nope/x.code-workspace')).toBe(workspaceFileId('/nope/x.code-workspace'));
  });
});

describe('slugify / sessionNameFor', () => {
  it('produces tmux-safe names', () => {
    expect(slugify('My Project.v2')).toBe('my-project-v2');
    expect(slugify('  weird:::name  ')).toBe('weird-name');
    expect(slugify('')).toBe('ws');
  });
  it('appends the first 8 chars of the workspace id', () => {
    expect(sessionNameFor('/x/My Project.v2', 'abcdef0123456789')).toBe('my-project-v2-abcdef01');
  });
});
