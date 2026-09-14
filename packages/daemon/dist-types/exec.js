import { execa } from 'execa';
export const realExec = async (cmd, args, opts = {}) => {
    const r = await execa(cmd, args, {
        env: opts.env ?? process.env,
        extendEnv: false,
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 10_000,
        reject: false,
        stdin: 'ignore',
        stripFinalNewline: false,
    });
    return { code: r.exitCode ?? 127, stdout: r.stdout, stderr: r.stderr };
};
//# sourceMappingURL=exec.js.map