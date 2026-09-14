import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export const emptyState = () => ({ version: 1, workspaces: {} });
/** Read the snapshot; a missing or corrupt file yields an empty state. */
export function loadState(file) {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof parsed === 'object' && parsed !== null && parsed.version === 1 && typeof parsed.workspaces === 'object') {
            return parsed;
        }
    }
    catch {
        // missing or corrupt
    }
    return emptyState();
}
/** Atomic write (tmp file + rename). */
export function saveState(file, state) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, file);
}
//# sourceMappingURL=state.js.map