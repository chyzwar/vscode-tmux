import type { Exec } from './exec.js';
import type { Registry } from './registry.js';
export interface OpenerOptions {
    registry: Registry;
    exec: Exec;
    codeCommand?: string;
    xdotoolAvailable: () => Promise<boolean>;
    log?: (line: string) => void;
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
    constructor(o: OpenerOptions);
    open(input: OpenInput): Promise<OpenOutcome>;
    private raise;
    private run;
}
