export interface TabState {
    name: string;
    cwd: string;
    command?: string[];
}
export interface WorkspaceState {
    folder: string;
    workspaceFile?: string;
    name: string;
    sessionName: string;
    tabs: TabState[];
}
export interface State {
    version: 1;
    workspaces: Record<string, WorkspaceState>;
}
export declare const emptyState: () => State;
/** Read the snapshot; a missing or corrupt file yields an empty state. */
export declare function loadState(file: string): State;
/** Atomic write (tmp file + rename). */
export declare function saveState(file: string, state: State): void;
