export interface WorkspaceIdentity {
    /** VS Code's own workspace id: the `workspaceStorage/<id>` segment of the storage path. */
    workspaceId: string;
    folder: string;
    workspaceFile?: string;
    name: string;
}
/**
 * Derive a stable identity for this window. VS Code computes `<id>` as
 * md5(folder path + inode) for folders and md5(path) for .code-workspace files,
 * and it never opens the same workspace in two windows, so the id is stable
 * across restarts and unique per window.
 */
export declare function identityFromStorageUri(storageUriFsPath: string | undefined, folder: string | undefined, workspaceFile: string | undefined, name: string): WorkspaceIdentity | undefined;
