import { Buffer } from 'node:buffer';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';
import { test } from '#testing/test.ts';

import { ContentLengthDecoder } from './content-length-decoder.ts';
import { encodeMessage } from './encode-message.ts';
import type { JsonRpcMessage } from './json-rpc-message.ts';

/** Messages with multi-byte text, and their framed byte stream and bodies. */
function sample(): {
  readonly stream: Buffer;
  readonly expected: readonly string[];
} {
  const messages: readonly JsonRpcMessage[] = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///tmp/ä' } },
    { jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'emoji 😀 and 𝒳 and €' } },
    { jsonrpc: '2.0', id: 'x', result: { text: 'こんにちは\r\nworld' } },
    { jsonrpc: '2.0', id: 2, error: { code: -32_601, message: 'nope' } },
    { jsonrpc: '2.0', method: 'empty' },
  ];
  return {
    stream: Buffer.concat(messages.map((message) => encodeMessage(message))),
    expected: messages.map((message) => JSON.stringify(message)),
  };
}

describe('ContentLengthDecoder', () => {
  test('decodes several messages from one chunk', ({ expect }) => {
    const { stream, expected } = sample();
    const decoder = new ContentLengthDecoder();
    expect(decoder.push(stream)).toStrictEqual({ ok: true, value: expected });
    expect(decoder.bufferedBytes).toBe(0);
  });

  test('decodes byte by byte, splitting headers and multi-byte characters', ({ expect }) => {
    const { stream, expected } = sample();
    const decoder = new ContentLengthDecoder();
    const bodies: string[] = [];
    for (const byte of stream) {
      const decoded = okValueFrom(decoder.push(Uint8Array.of(byte)));
      bodies.push(...decoded);
    }
    expect(bodies).toStrictEqual(expected);
  });

  test('yields the same messages for every random chunking (property)', ({ expect }) => {
    const { stream, expected } = sample();
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
        const decoded = okValueFrom(decoder.push(stream.subarray(offset, offset + size)));
        bodies.push(...decoded);
        offset += size;
      }
      expect(bodies).toStrictEqual(expected);
    }
  });

  test('accepts other headers in any case and order', ({ expect }) => {
    const body = '{"jsonrpc":"2.0","method":"m"}';
    const frame = `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${String(body.length)}\r\n\r\n${body}`;
    expect(new ContentLengthDecoder().push(Buffer.from(frame))).toStrictEqual({
      ok: true,
      value: [body],
    });
  });

  test('fails on missing or malformed lengths and stays failed', ({ expect }) => {
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

  test('bounds header and body sizes', ({ expect }) => {
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
