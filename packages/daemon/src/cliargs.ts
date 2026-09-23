/**
 * `new [name words] [-- cmd args]`: the words before `--` name the tab, the rest
 * is the command. commander drops the `--` while parsing (lib/command.js,
 * `parseOptions`: everything after it is pushed onto the operands and the token
 * itself is not kept) and its public API exposes nothing that says where it
 * was (`rawArgs` exists but is not in the typings). So the command is peeled
 * off the argv before commander sees it. Only `new` uses it.
 */
export function peelCommand(argv: string[]): { argv: string[]; command?: string[] } {
  const dash = argv.indexOf('--');
  if (dash === -1) return { argv };
  const command = argv.slice(dash + 1);
  return command.length ? { argv: argv.slice(0, dash), command } : { argv: argv.slice(0, dash) };
}
