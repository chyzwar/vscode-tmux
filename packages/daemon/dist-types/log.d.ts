export type Log = (line: string) => void;
/** Append timestamped lines to a file; also mirror to stderr when `echo` is set. */
export declare function fileLogger(file: string, echo?: boolean): Log;
