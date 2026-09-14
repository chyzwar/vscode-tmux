import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Log = (line: string) => void;

/** Append timestamped lines to a file; also mirror to stderr when `echo` is set. */
export function fileLogger(file: string, echo = false): Log {
  mkdirSync(dirname(file), { recursive: true });
  return (line) => {
    const entry = `${new Date().toISOString()} ${line}\n`;
    try {
      appendFileSync(file, entry);
    } catch {
      // logging must never break the daemon
    }
    if (echo) process.stderr.write(entry);
  };
}
