import { describe, expect, it } from 'vitest';
import { NdjsonDecoder, encode, type Message } from '../src/index.js';

describe('encode', () => {
  it('serializes a message as one JSON line', () => {
    const msg: Message = { type: 'list', id: '1' };
    expect(encode(msg)).toBe('{"type":"list","id":"1"}\n');
  });
});

describe('NdjsonDecoder', () => {
  it('decodes a single complete line', () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"list","id":"1"}\n')).toEqual([{ type: 'list', id: '1' }]);
  });

  it('decodes two lines in one chunk', () => {
    const d = new NdjsonDecoder();
    const out = d.push('{"type":"list","id":"1"}\n{"type":"status","id":"2"}\n');
    expect(out.map((m) => m.type)).toEqual(['list', 'status']);
  });

  it('buffers a line split across chunks', () => {
    const d = new NdjsonDecoder();
    expect(d.push(Buffer.from('{"type":"li'))).toEqual([]);
    expect(d.push('st","id":"1"}\n')).toEqual([{ type: 'list', id: '1' }]);
  });

  it('skips invalid JSON lines and keeps going', () => {
    const d = new NdjsonDecoder();
    const out = d.push('not json\n{"type":"status","id":"2"}\n');
    expect(out).toEqual([{ type: 'status', id: '2' }]);
  });

  it('skips lines without a string type', () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"id":"x"}\n[1,2]\n')).toEqual([]);
  });

  it('drops unknown message types and requests without an id', () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"bogus","id":"1"}\n{"type":"list"}\n{"type":"list","id":""}\n')).toEqual([]);
  });

  it('strips keys the schema does not know', () => {
    const d = new NdjsonDecoder();
    expect(d.push('{"type":"list","id":"1","extra":true}\n')).toEqual([{ type: 'list', id: '1' }]);
  });

  it('reports every dropped line with a reason', () => {
    const dropped: [string, string][] = [];
    const d = new NdjsonDecoder((line, reason) => dropped.push([line, reason]));
    d.push('nope\n{"type":"hello","id":"1"}\n{"type":"status","id":"2"}\n');
    expect(dropped.map(([line]) => line)).toEqual(['nope', '{"type":"hello","id":"1"}']);
    expect(dropped[0]![1]).toBe('invalid JSON');
    expect(dropped[1]![1]).toMatch(/workspaceId/);
  });
});
