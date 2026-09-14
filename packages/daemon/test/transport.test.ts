import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlreadyRunningError, listen, tryConnect } from '../src/transport.js';

describe('listen', () => {
  it('lets exactly one of several concurrent daemons win', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'vst-l-')), 'd.sock');
    const noop = () => {};
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => listen({ socketPath, onConnection: noop, onDisconnect: noop })));
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);
    for (const l of losers) expect((l as PromiseRejectedResult).reason).toBeInstanceOf(AlreadyRunningError);
    const conn = await tryConnect(socketPath);
    expect(conn).toBeDefined();
    conn!.close();
    (winners[0] as PromiseFulfilledResult<{ close: () => void }>).value.close();
  });

  it('replaces a stale socket file', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'vst-l-')), 'd.sock');
    const noop = () => {};
    const first = await listen({ socketPath, onConnection: noop, onDisconnect: noop });
    await new Promise<void>((r) => first.close(() => r()));
    // net.Server.close() does not unlink the path on all Node versions; simulate a crash leftover
    const second = await listen({ socketPath, onConnection: noop, onDisconnect: noop });
    expect(await tryConnect(socketPath)).toBeDefined();
    second.close();
  });
});
