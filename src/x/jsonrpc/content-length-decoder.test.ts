import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { ContentLengthDecoder } from './content-length-decoder.ts';
import { encodeMessage } from './encode-message.ts';
import type { JsonRpcMessage } from './json-rpc-message.ts';

const messages: readonly JsonRpcMessage[] = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///tmp/ä' } },
  { jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'emoji 😀 and 𝒳 and €' } },
  { jsonrpc: '2.0', id: 'x', result: { text: 'こんにちは\r\nworld' } },
  { jsonrpc: '2.0', id: 2, error: { code: -32_601, message: 'nope' } },
  { jsonrpc: '2.0', method: 'empty' },
];

const stream = Buffer.concat(messages.map((message) => encodeMessage(message)));
const expected = messages.map((message) => JSON.stringify(message));

describe('ContentLengthDecoder', () => {
  it('decodes several messages from one chunk', () => {
    const decoder = new ContentLengthDecoder();
    expect(decoder.push(stream)).toEqual({ ok: true, value: expected });
    expect(decoder.bufferedBytes).toBe(0);
  });

  it('decodes byte by byte, splitting headers and multi-byte characters', () => {
    const decoder = new ContentLengthDecoder();
    const bodies: string[] = [];
    for (const byte of stream) {
      const result = decoder.push(Uint8Array.of(byte));
      expect(result.ok).toBe(true);
      if (result.ok) {
        bodies.push(...result.value);
      }
    }
    expect(bodies).toEqual(expected);
  });

  it('yields the same messages for every random chunking (property)', () => {
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let trial = 0; trial < 300; trial += 1) {
      const decoder = new ContentLengthDecoder();
      const bodies: string[] = [];
      let offset = 0;
      while (offset < stream.byteLength) {
        const size = 1 + Math.floor(random() * 40);
        const result = decoder.push(stream.subarray(offset, offset + size));
        if (!result.ok) {
          throw new Error(JSON.stringify(result.error));
        }
        bodies.push(...result.value);
        offset += size;
      }
      expect(bodies).toEqual(expected);
    }
  });

  it('accepts other headers in any case and order', () => {
    const body = '{"jsonrpc":"2.0","method":"m"}';
    const frame = `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${String(body.length)}\r\n\r\n${body}`;
    expect(new ContentLengthDecoder().push(Buffer.from(frame))).toEqual({
      ok: true,
      value: [body],
    });
  });

  it('fails on missing or malformed lengths and stays failed', () => {
    const missing = new ContentLengthDecoder();
    expect(missing.push(Buffer.from('X-Foo: 1\r\n\r\n{}'))).toMatchObject({
      ok: false,
      error: { kind: 'missing-content-length' },
    });
    expect(missing.push(encodeMessage({ jsonrpc: '2.0', method: 'm' }))).toMatchObject({
      ok: false,
    });
    expect(
      new ContentLengthDecoder().push(Buffer.from('Content-Length: -3\r\n\r\n')),
    ).toMatchObject({
      ok: false,
      error: { kind: 'invalid-content-length', value: '-3' },
    });
  });

  it('bounds header and body sizes', () => {
    const decoder = new ContentLengthDecoder({ maxHeaderBytes: 32, maxMessageBytes: 10 });
    const oversizedHeader = Buffer.from('X'.repeat(40));
    expect(decoder.push(oversizedHeader)).toMatchObject({
      ok: false,
      error: { kind: 'header-too-large' },
    });
    expect(
      new ContentLengthDecoder({ maxMessageBytes: 10 }).push(
        Buffer.from('Content-Length: 11\r\n\r\n'),
      ),
    ).toMatchObject({ ok: false, error: { kind: 'message-too-large', length: 11 } });
  });
});
