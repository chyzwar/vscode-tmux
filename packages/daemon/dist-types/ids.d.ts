/**
 * VS Code's workspace identifier for a single folder on Linux:
 * md5(fsPath + String(inode)). Mirrors
 * src/vs/platform/workspaces/node/workspaces.ts (getSingleFolderWorkspaceIdentifier).
 */
export declare function folderWorkspaceId(fsPath: string, ino: number | bigint): string;
/** VS Code's identifier for a `.code-workspace` file on Linux: md5(path). */
export declare function workspaceFileId(fsPath: string): string;
/**
 * Compute the VS Code workspace id for a path the way VS Code would.
 * Directories use the inode rule; anything else (a .code-workspace file,
 * or a path that does not exist) uses the path rule.
 */
export declare function computeWorkspaceId(p: string): Promise<string>;
/** Lowercase, tmux-safe slug: only [a-z0-9_-], collapsed, trimmed; never empty. */
export declare function slugify(name: string): string;
/** tmux session name for a workspace: `<slug>-<workspaceId[0:8]>`. */
export declare function sessionNameFor(folder: string, workspaceId: string): string;
