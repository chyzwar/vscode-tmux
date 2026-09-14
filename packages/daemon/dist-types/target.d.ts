export interface Target {
    path: string;
    line?: number;
    col?: number;
}
/**
 * Parse `path[:line[:col]]`, `path#Lline`, or `.` into an absolute target.
 * Non-numeric suffixes stay part of the file name.
 */
export declare function parseTarget(target: string, cwd: string): Target;
