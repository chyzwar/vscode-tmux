import { describe, expect, it } from 'vitest';
import { peelCommand } from '../src/cliargs.js';

describe('peelCommand', () => {
  it('splits at the first -- and keeps the command argv intact', () => {
    expect(peelCommand(['new', 'dev', 'server', '--', 'bun', 'run', 'dev', '--port', '3000'])).toEqual({
      argv: ['new', 'dev', 'server'],
      command: ['bun', 'run', 'dev', '--port', '3000'],
    });
    expect(peelCommand(['new', '--', 'sh', '-c', 'a -- b'])).toEqual({ argv: ['new'], command: ['sh', '-c', 'a -- b'] });
  });
  it('has no command without --, or with nothing after it', () => {
    expect(peelCommand(['new', 'logs'])).toEqual({ argv: ['new', 'logs'] });
    expect(peelCommand(['new', 'logs', '--'])).toEqual({ argv: ['new', 'logs'] });
    expect(peelCommand([])).toEqual({ argv: [] });
  });
});
