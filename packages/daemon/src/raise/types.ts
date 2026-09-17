/** Brings a VS Code window to the front. Implementations are desktop specific (see index.ts). */
export interface WindowRaiser {
  /**
   * Raise the window titled `title`, or, while VS Code has not renamed the window yet, the only
   * window whose title names `workspaceName`. `isFocused` asks that window's extension host whether
   * the window has OS focus; raisers without a verification channel of their own use it to confirm.
   */
  raise(title: string, workspaceName: string, isFocused: () => Promise<boolean>): Promise<boolean>;
}
