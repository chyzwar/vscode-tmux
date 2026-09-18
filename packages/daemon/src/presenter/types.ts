/**
 * Presentation layer: what the user sees. The presenter owns the terminal
 * container and makes it display a backend session. Implementations:
 * GhosttyPresenter (quake dropdown holding a single surface + tmux tab bar);
 * a kitty presenter with native tabs is planned.
 */
export interface Presenter {
  /**
   * Make `session` the one the terminal shows: now for a client that is
   * attached, and on attach for one that is not. This does not pull the
   * dropdown down — only the user's hotkey does that.
   */
  show(session: string): Promise<void>;
  /** Ensure the terminal container is running without changing what it shows. */
  ensureVisible(): Promise<void>;
}
