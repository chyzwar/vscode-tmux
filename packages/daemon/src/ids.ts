import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * VS Code's workspace identifier for a single folder on Linux:
 * md5(fsPath + String(inode)). Mirrors
 * src/vs/platform/workspaces/node/workspaces.ts (getSingleFolderWorkspaceIdentifier).
 */
export function folderWorkspaceId(fsPath: string, ino: number | bigint): string {
  return createHash('md5').update(fsPath).update(String(ino)).digest('hex');
}

/** VS Code's identifier for a `.code-workspace` file on Linux: md5(path). */
export function workspaceFileId(fsPath: string): string {
  return createHash('md5').update(fsPath).digest('hex');
}

/**
 * Compute the VS Code workspace id for a path the way VS Code would.
 * Directories use the inode rule; anything else (a .code-workspace file,
 * or a path that does not exist) uses the path rule.
 */
export async function computeWorkspaceId(p: string): Promise<string> {
  try {
    const s = await stat(p, { bigint: true });
    if (s.isDirectory()) return folderWorkspaceId(p, s.ino);
  } catch {
    // fall through to the path rule
  }
  return workspaceFileId(p);
}

/** Lowercase, tmux-safe slug: only [a-z0-9_-], collapsed, trimmed; never empty. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'ws';
}

/** tmux session name for a workspace: `<slug>-<workspaceId[0:8]>`. */
export function sessionNameFor(folder: string, workspaceId: string): string {
  return `${slugify(basename(folder))}-${workspaceId.slice(0, 8)}`;
}
