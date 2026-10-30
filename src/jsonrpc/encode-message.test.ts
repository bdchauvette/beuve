import { Buffer } from 'node:buffer';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { encodeMessage } from './encode-message.ts';

describe('encodeMessage', () => {
  test('counts UTF-8 bytes, not UTF-16 code units', ({ expect }) => {
    const encoded = encodeMessage({ jsonrpc: '2.0', method: 'm', params: { text: '😀é' } });
    const text = encoded.toString('utf8');
    const separator = text.indexOf('\r\n\r\n');
    const header = text.slice(0, separator);
    const body = text.slice(separator + 4);
    expect(header).toBe('Content-Length: 57');
    expect(Buffer.byteLength(body, 'utf8')).toBe(57);
    expect(JSON.parse(body)).toStrictEqual({
      jsonrpc: '2.0',
      method: 'm',
      params: { text: '😀é' },
    });
  });
});
