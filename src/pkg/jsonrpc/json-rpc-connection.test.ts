import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';

import { ContentLengthDecoder } from './content-length-decoder.ts';
import { encodeMessage } from './encode-message.ts';
import { JsonRpcConnection } from './json-rpc-connection.ts';
import type { JsonRpcCloseReason, JsonRpcConnectionOptions } from './json-rpc-connection.ts';
import type { JsonRpcMessage } from './json-rpc-message.ts';

/** An in-memory peer: what the connection writes is decoded into `sent`; `send` feeds it bytes. */
interface FakePeer {
  readonly connection: JsonRpcConnection;
  readonly sent: unknown[];
  readonly closes: JsonRpcCloseReason[];
  readonly send: (message: JsonRpcMessage) => void;
  readonly sendRaw: (bytes: string) => void;
  readonly endInput: () => void;
  readonly nextSent: () => Promise<unknown>;
}

const peers: FakePeer[] = [];

afterEach(() => {
  for (const peer of peers.splice(0)) {
    peer.connection.close();
  }
});

function createPeer(options: Partial<JsonRpcConnectionOptions> = {}): FakePeer {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent: unknown[] = [];
  const closes: JsonRpcCloseReason[] = [];
  const waiters: ((message: unknown) => void)[] = [];
  let consumed = 0;
  const decoder = new ContentLengthDecoder();
  output.on('data', (chunk: Buffer) => {
    const decoded = decoder.push(chunk);
    const bodies = decoded.ok ? decoded.value : [];
    for (const body of bodies) {
      const message: unknown = JSON.parse(body);
      sent.push(message);
      const waiter = waiters.shift();
      if (waiter === undefined) {
        continue;
      }
      consumed += 1;
      waiter(message);
    }
  });
  const connection = new JsonRpcConnection({
    input,
    output,
    cancelMethod: '$/cancelRequest',
    onClose: (reason): void => {
      closes.push(reason);
    },
    ...options,
  });
  const peer: FakePeer = {
    connection,
    sent,
    closes,
    send: (message): void => {
      input.write(encodeMessage(message));
    },
    sendRaw: (bytes): void => {
      input.write(bytes);
    },
    endInput: (): void => {
      input.end();
    },
    nextSent: async (): Promise<unknown> => {
      if (consumed < sent.length) {
        consumed += 1;
        return sent[consumed - 1];
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
  };
  peers.push(peer);
  return peer;
}

describe('JsonRpcConnection', () => {
  it('correlates out-of-order responses with their requests', async () => {
    const peer = createPeer();
    const first = peer.connection.request('a', { n: 1 });
    const second = peer.connection.request('b', [2]);
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 1, method: 'a', params: { n: 1 } });
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 2, method: 'b' });
    peer.send({ jsonrpc: '2.0', id: 2, result: 'two' });
    peer.send({ jsonrpc: '2.0', id: 1, error: { code: -32_000, message: 'no', data: 3 } });
    await expect(second).resolves.toEqual(ok('two'));
    await expect(first).resolves.toEqual(
      err({ kind: 'remote-error', method: 'a', code: -32_000, message: 'no', data: 3 }),
    );
    expect(peer.connection.pendingRequests).toBe(0);
  });

  it('times out and sends $/cancelRequest, ignoring the late response', async () => {
    const peer = createPeer();
    const result = await peer.connection.request('slow', undefined, { timeoutMs: 20 });
    expect(result).toEqual(err({ kind: 'timeout', method: 'slow', timeoutMs: 20 }));
    expect(peer.sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'slow' },
      { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } },
    ]);
    peer.send({ jsonrpc: '2.0', id: 1, result: 'late' });
    expect(peer.connection.closeReason).toBeUndefined();
  });

  it('cancels through an AbortSignal', async () => {
    const peer = createPeer();
    const controller = new AbortController();
    const pending = peer.connection.request('long', {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual(err({ kind: 'cancelled', method: 'long' }));
    await expect(peer.connection.request('x', {}, { signal: controller.signal })).resolves.toEqual(
      err({ kind: 'cancelled', method: 'x' }),
    );
  });

  it('dispatches notifications and answers peer requests', async () => {
    const notifications: unknown[] = [];
    const peer = createPeer({
      onNotification: (method, params): void => {
        notifications.push({ method, params });
      },
      onRequest: (method, params) =>
        method === 'echo' ? ok(params) : err({ code: -32_601, message: `no ${method}` }),
    });
    peer.send({ jsonrpc: '2.0', method: 'hello', params: { a: 1 } });
    peer.send({ jsonrpc: '2.0', id: 'r1', method: 'echo', params: [1, 2] });
    await expect(peer.nextSent()).resolves.toEqual({ jsonrpc: '2.0', id: 'r1', result: [1, 2] });
    peer.send({ jsonrpc: '2.0', id: 'r2', method: 'other' });
    await expect(peer.nextSent()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'r2',
      error: { code: -32_601, message: 'no other' },
    });
    expect(notifications).toEqual([{ method: 'hello', params: { a: 1 } }]);
  });

  it('answers method-not-found without a handler, and internal-error when one throws', async () => {
    const plain = createPeer();
    plain.send({ jsonrpc: '2.0', id: 1, method: 'x' });
    await expect(plain.nextSent()).resolves.toMatchObject({ id: 1, error: { code: -32_601 } });

    const throwing = createPeer({
      onRequest: (): never => {
        throw new Error('boom');
      },
    });
    throwing.send({ jsonrpc: '2.0', id: 2, method: 'x' });
    await expect(throwing.nextSent()).resolves.toMatchObject({ id: 2, error: { code: -32_603 } });
  });

  it('honours $/cancelRequest for peer requests', async () => {
    let wasAborted = false;
    const peer = createPeer({
      onRequest: async (_method, _params, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            wasAborted = true;
            setTimeout(() => {
              resolve(ok('too late'));
            }, 5);
          });
        }),
    });
    peer.send({ jsonrpc: '2.0', id: 9, method: 'wait' });
    peer.send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 9 } });
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 9, error: { code: -32_800 } });
    expect(wasAborted).toBe(true);
  });

  it('drops malformed messages and keeps going', async () => {
    const peer = createPeer();
    const body = '{"jsonrpc":"1.0"}';
    peer.sendRaw(`Content-Length: ${String(body.length)}\r\n\r\n${body}`);
    const pending = peer.connection.request('still-alive', {});
    await peer.nextSent();
    peer.send({ jsonrpc: '2.0', id: 1, result: true });
    await expect(pending).resolves.toEqual(ok(true));
  });

  it('settles pending requests as closed when input ends, and refuses new work', async () => {
    const peer = createPeer();
    const pending = peer.connection.request('a', {});
    peer.endInput();
    await expect(pending).resolves.toEqual(err({ kind: 'closed', method: 'a' }));
    expect(peer.closes).toEqual([{ kind: 'input-ended' }]);
    await expect(peer.connection.request('b', {})).resolves.toEqual(
      err({ kind: 'closed', method: 'b' }),
    );
    expect(peer.connection.notify('c')).toEqual(err({ kind: 'closed', method: 'c' }));
  });

  it('closes on a framing error', async () => {
    const peer = createPeer();
    const pending = peer.connection.request('a', {});
    peer.sendRaw('Bogus: header\r\n\r\n');
    await expect(pending).resolves.toEqual(err({ kind: 'closed', method: 'a' }));
    expect(peer.closes).toMatchObject([
      { kind: 'framing-error', error: { kind: 'missing-content-length' } },
    ]);
  });
});
