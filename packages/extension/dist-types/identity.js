"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityFromStorageUri = identityFromStorageUri;
const node_path_1 = require("node:path");
/**
 * Derive a stable identity for this window. VS Code computes `<id>` as
 * md5(folder path + inode) for folders and md5(path) for .code-workspace files,
 * and it never opens the same workspace in two windows, so the id is stable
 * across restarts and unique per window.
 */
function identityFromStorageUri(storageUriFsPath, folder, workspaceFile, name) {
    if (!storageUriFsPath || !folder)
        return undefined;
    const workspaceId = (0, node_path_1.basename)((0, node_path_1.dirname)(storageUriFsPath));
    if (!workspaceId)
        return undefined;
    const id = { workspaceId, folder, name: name || (0, node_path_1.basename)(folder) };
    if (workspaceFile)
        id.workspaceFile = workspaceFile;
    return id;
}
//# sourceMappingURL=identity.js.map