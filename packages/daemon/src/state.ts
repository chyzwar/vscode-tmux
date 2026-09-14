import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

export const emptyState = (): State => ({ version: 1, workspaces: {} });

/** Read the snapshot; a missing or corrupt file yields an empty state. */
export function loadState(file: string): State {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && (parsed as State).version === 1 && typeof (parsed as State).workspaces === 'object') {
      return parsed as State;
    }
  } catch {
    // missing or corrupt
  }
  return emptyState();
}

/** Atomic write (tmp file + rename). */
export function saveState(file: string, state: State): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, file);
}
