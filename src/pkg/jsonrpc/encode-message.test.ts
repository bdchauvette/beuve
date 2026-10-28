import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { encodeMessage } from './encode-message.ts';

describe('encodeMessage', () => {
  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    const encoded = encodeMessage({ jsonrpc: '2.0', method: 'm', params: { text: '😀é' } });
    const text = encoded.toString('utf8');
    const separator = text.indexOf('\r\n\r\n');
    const header = text.slice(0, separator);
    const body = text.slice(separator + 4);
    expect(header).toBe('Content-Length: 57');
    expect(Buffer.byteLength(body, 'utf8')).toBe(57);
    expect(JSON.parse(body)).toEqual({
      jsonrpc: '2.0',
      method: 'm',
      params: { text: '😀é' },
    });
  });
});
