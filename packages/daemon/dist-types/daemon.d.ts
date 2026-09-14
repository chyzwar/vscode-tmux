export interface DaemonOptions {
    foreground?: boolean;
}
/** Composition root: wires backend, presenter, opener and server, then listens. */
export declare function runDaemon(o?: DaemonOptions): Promise<void>;
