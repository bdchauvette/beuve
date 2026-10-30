import { describe, expect, it } from 'vitest';

import { parseMessage } from './parse-message.ts';

describe('parseMessage', () => {
  it('classifies requests, notifications and responses', () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":1,"method":"a","params":{}}')).toEqual({
      ok: true,
      value: { kind: 'request', message: { jsonrpc: '2.0', id: 1, method: 'a', params: {} } },
    });
    expect(parseMessage('{"jsonrpc":"2.0","method":"b","params":[1]}')).toMatchObject({
      ok: true,
      value: { kind: 'notification', message: { method: 'b', params: [1] } },
    });
    expect(parseMessage('{"jsonrpc":"2.0","id":"7","result":0}')).toEqual({
      ok: true,
      value: { kind: 'response', message: { jsonrpc: '2.0', id: '7', result: 0 } },
    });
    expect(
      parseMessage('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"bad"}}'),
    ).toMatchObject({
      ok: true,
      value: { kind: 'response', message: { error: { code: -32_700 } } },
    });
  });

  it('rejects malformed messages', () => {
    for (const body of [
      'not json',
      '[]',
      '{"id":1,"method":"a"}',
      '{"jsonrpc":"2.0","id":{},"method":"a"}',
      '{"jsonrpc":"2.0","method":"a","params":3}',
      '{"jsonrpc":"2.0","id":1}',
      '{"jsonrpc":"2.0","id":1,"result":1,"error":{"code":1,"message":"x"}}',
      '{"jsonrpc":"2.0","id":1,"error":{"code":"x","message":"x"}}',
    ]) {
      expect(parseMessage(body).ok, body).toBe(false);
    }
  });
});
