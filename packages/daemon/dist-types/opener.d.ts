import type { Exec } from './exec.js';
import type { Registry } from './registry.js';
export interface OpenerOptions {
    registry: Registry;
    exec: Exec;
    codeCommand?: string;
    xdotoolAvailable: () => Promise<boolean>;
    log?: (line: string) => void;
    sleep?: (ms: number) => Promise<void>;
    /** How many times to look for the exact window title (VS Code updates it asynchronously). */
    titleAttempts?: number;
    titleRetryMs?: number;
}
export interface OpenInput {
    workspaceId?: string;
    cwd: string;
    target: string;
}
export interface OpenOutcome {
    via: 'extension' | 'code-cli' | 'code-cli-fallback';
    title?: string;
    raised?: boolean;
}
export declare function escapeRegex(s: string): string;
/**
 * Routes "open this file" requests from terminals to the right VS Code window:
 * via the connected extension when the window is open (exact window, then raise
 * it with xdotool since VS Code runs under XWayland), otherwise via `code <folder> --goto`.
 */
export declare class Opener {
    private readonly o;
    private readonly code;
    private readonly log;
    private readonly sleep;
    private readonly titleAttempts;
    private readonly titleRetryMs;
    constructor(o: OpenerOptions);
    open(input: OpenInput): Promise<OpenOutcome>;
    private raise;
    /**
     * Find the X11 window of the target VS Code window. The exact title is tried
     * a few times because VS Code renames the window shortly after the editor
     * opens; then a match on " - <workspace name> - " is accepted if unambiguous.
     */
    private findWindow;
    /**
     * Bring an X11 window to the front. `windowactivate` (_NET_ACTIVE_WINDOW) is
     * subject to Mutter's focus-stealing prevention and is often ignored, while a
     * direct raise + XSetInputFocus between XWayland windows is honored; do both
     * and verify with getactivewindow.
     */
    private activate;
    private search;
    private run;
}
