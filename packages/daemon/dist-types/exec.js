import { execFile } from 'node:child_process';
export const realExec = (cmd, args, opts = {}) => new Promise((resolvePromise) => {
    execFile(cmd, args, { env: opts.env ?? process.env, cwd: opts.cwd, timeout: opts.timeoutMs ?? 10_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number'
            ? error.code
            : error
                ? 127
                : 0;
        resolvePromise({ code, stdout: String(stdout), stderr: String(stderr) });
    });
});
//# sourceMappingURL=exec.js.map