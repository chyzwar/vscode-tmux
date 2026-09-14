import { describe, expect, it } from 'vitest';
import { identityFromStorageUri } from '../src/identity.js';

describe('identityFromStorageUri', () => {
  it('extracts the workspace id from the storage path', () => {
    expect(
      identityFromStorageUri('/home/u/.config/Code/User/workspaceStorage/4e830601b1054e256ccbde75e89e77e3/mapka.vscode-tmux', '/home/u/p', undefined, 'p'),
    ).toEqual({ workspaceId: '4e830601b1054e256ccbde75e89e77e3', folder: '/home/u/p', name: 'p' });
  });
  it('keeps the workspace file when present', () => {
    expect(identityFromStorageUri('/x/workspaceStorage/abc/ext', '/home/u/p', '/home/u/p.code-workspace', 'p (Workspace)')).toEqual({
      workspaceId: 'abc',
      folder: '/home/u/p',
      workspaceFile: '/home/u/p.code-workspace',
      name: 'p (Workspace)',
    });
  });
  it('returns undefined for empty windows', () => {
    expect(identityFromStorageUri(undefined, undefined, undefined, '')).toBeUndefined();
    expect(identityFromStorageUri('/x/workspaceStorage/abc/ext', undefined, undefined, '')).toBeUndefined();
  });
});
