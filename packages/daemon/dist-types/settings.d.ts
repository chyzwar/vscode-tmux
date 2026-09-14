export interface Settings {
    /**
     * GDK backend for the companion Ghostty instance.
     * `x11` (default): run under XWayland. On GNOME 42 Wayland a Ghostty started by a
     * background process never creates its terminal surface when it runs natively on
     * Wayland (see docs/e2e.md), and an X11 window can be raised with xdotool.
     * `wayland`: native Wayland (works on compositors such as KWin).
     * `default`: leave GDK_BACKEND untouched.
     */
    ghosttyGdkBackend: 'x11' | 'wayland' | 'default';
    /** Seconds to wait for Ghostty to attach its tmux client after launch. */
    ghosttyStartTimeoutMs: number;
}
export declare const DEFAULT_SETTINGS: Settings;
/** Read `<configDir>/config.json`; missing file or unknown keys are fine, bad values fall back to defaults. */
export declare function loadSettings(file: string): Settings;
/** Environment additions for the Ghostty process derived from settings. */
export declare function ghosttyEnvFor(settings: Settings): Record<string, string>;
