/**
 * Presentation layer: what the user sees. The presenter owns the terminal
 * window and makes it display a backend session. Implementations:
 * GhosttyPresenter (single surface + tmux tab bar); a kitty presenter with
 * native tabs is planned.
 */
export interface Presenter {
  /** Make the terminal window exist and show `session` (creating the window if needed). */
  show(session: string): Promise<void>;
  /** Ensure the terminal window exists without changing what it shows. */
  ensureVisible(): Promise<void>;
}
