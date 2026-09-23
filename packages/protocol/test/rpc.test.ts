import { describe, expect, it } from 'vitest';
import { PendingRequests, decodeReply, errorResult, okResult, type Message, type ResultMessage } from '../src/index.js';

function harness(newId = () => 'id-1') {
  const sent: Message[] = [];
  const rpc = new PendingRequests((m) => sent.push(m), newId);
  return { rpc, sent };
}

describe('PendingRequests.request', () => {
  it('assigns an id, sends type + id + body, and resolves a typed reply', async () => {
    const { rpc, sent } = harness();
    const p = rpc.request('showSession', { workspaceId: 'w1' }, 1000);
    expect(sent).toEqual([{ type: 'showSession', id: 'id-1', workspaceId: 'w1' }]);
    expect(rpc.settle({ type: 'result', id: 'id-1', ok: true, data: { sessionName: 'proj-w1' } })).toBe(true);
    const reply = await p;
    expect(reply).toEqual({ ok: true, data: { sessionName: 'proj-w1' } });
    if (reply.ok) expect(reply.data.sessionName).toBe('proj-w1'); // typed access, no cast
  });

  it('passes an error reply through', async () => {
    const { rpc } = harness();
    const p = rpc.request('list', {}, 1000);
    rpc.settle({ type: 'result', id: 'id-1', ok: false, error: 'nope' });
    expect(await p).toEqual({ ok: false, error: 'nope' });
  });

  it('reports data that fails the result schema as an error instead of throwing', async () => {
    const { rpc } = harness();
    const p = rpc.request('showSession', { workspaceId: 'w1' }, 1000);
    rpc.settle({ type: 'result', id: 'id-1', ok: true, data: { sessionName: 7 } });
    const reply = await p;
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error).toMatch(/malformed reply to showSession/);
  });

  it('rejects on timeout and forgets the id', async () => {
    const { rpc } = harness();
    await expect(rpc.request('status', {}, 5)).rejects.toThrow(/timeout waiting for reply to status/);
    expect(rpc.settle({ type: 'result', id: 'id-1', ok: true, data: {} })).toBe(false);
  });

  it('rejects everything outstanding on rejectAll', async () => {
    let n = 0;
    const { rpc } = harness(() => `id-${++n}`);
    const a = rpc.request('list', {}, 1000);
    const b = rpc.request('status', {}, 1000);
    expect(rpc.size).toBe(2);
    rpc.rejectAll('connection closed');
    await expect(a).rejects.toThrow('connection closed');
    await expect(b).rejects.toThrow('connection closed');
    expect(rpc.size).toBe(0);
  });
});

describe('PendingRequests.settle', () => {
  it('is false for anything that is not a reply to a pending request', () => {
    const { rpc } = harness();
    expect(rpc.settle({ type: 'list', id: 'id-1' })).toBe(false);
    expect(rpc.settle({ type: 'result', id: 'unknown', ok: true })).toBe(false);
  });
});

describe('decodeReply / okResult / errorResult', () => {
  it('builds wire replies and decodes them back', () => {
    const req = { type: 'windowStateRequest', id: 'r9' } as const;
    const ok: ResultMessage = okResult(req, { focused: true });
    expect(ok).toEqual({ type: 'result', id: 'r9', ok: true, data: { focused: true } });
    expect(decodeReply('windowStateRequest', ok)).toEqual({ ok: true, data: { focused: true } });
    expect(decodeReply('windowStateRequest', errorResult('r9', 'boom'))).toEqual({ ok: false, error: 'boom' });
    expect(decodeReply('windowStateRequest', { type: 'result', id: 'r9', ok: false })).toEqual({ ok: false, error: 'windowStateRequest failed' });
    // @ts-expect-error data must match the result schema of the request type
    okResult(req, { title: 'x' });
  });
});
