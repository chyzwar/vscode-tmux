/** Window-title matching shared by the raisers. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Anchored pattern for the exact title the extension predicted for its window. */
export const exactTitlePattern = (title: string): string => `^${escapeRegex(title)}$`;

/** Loose pattern: the " - <workspace name> - " segment VS Code puts between the editor name and the app name. */
export const workspacePattern = (workspaceName: string): string => ` - ${escapeRegex(workspaceName)} - `;
