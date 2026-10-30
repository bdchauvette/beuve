import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { createFakePeer } from './testing/create-fake-peer.ts';
describe('JsonRpcConnection', () => {
  test('correlates out-of-order responses with their requests', async ({
    expect,
    closing,
    signal,
  }) => {
    const peer = closing(createFakePeer());
    const first = peer.connection.request('a', { n: 1 }, { signal });
    const second = peer.connection.request('b', [2], { signal });
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 1, method: 'a', params: { n: 1 } });
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 2, method: 'b' });
    peer.send({ jsonrpc: '2.0', id: 2, result: 'two' });
    peer.send({ jsonrpc: '2.0', id: 1, error: { code: -32_000, message: 'no', data: 3 } });
    await expect(second).resolves.toStrictEqual(ok('two'));
    await expect(first).resolves.toStrictEqual(
      err({ kind: 'remote-error', method: 'a', code: -32_000, message: 'no', data: 3 }),
    );
    expect(peer.connection.pendingRequests).toBe(0);
  });

  test('times out and sends $/cancelRequest, ignoring the late response', async ({
    expect,
    closing,
    signal,
  }) => {
    const peer = closing(createFakePeer());
    const result = await peer.connection.request('slow', undefined, {
      timeout: Temporal.Duration.from({ milliseconds: 20 }),
      signal,
    });
    expect(result).toStrictEqual(
      err({
        kind: 'timeout',
        method: 'slow',
        timeout: Temporal.Duration.from({ milliseconds: 20 }),
      }),
    );
    expect(peer.sent).toStrictEqual([
      { jsonrpc: '2.0', id: 1, method: 'slow' },
      { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } },
    ]);
    peer.send({ jsonrpc: '2.0', id: 1, result: 'late' });
    expect(peer.connection.closeReason).toBeUndefined();
  });

  test('cancels through an AbortSignal', async ({ expect, closing }) => {
    const peer = closing(createFakePeer());
    const controller = new AbortController();
    const pending = peer.connection.request('long', {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toStrictEqual(err({ kind: 'cancelled', method: 'long' }));
    await expect(
      peer.connection.request('x', {}, { signal: controller.signal }),
    ).resolves.toStrictEqual(err({ kind: 'cancelled', method: 'x' }));
  });

  test('reports a caller’s own timeout signal as a cancellation, not as its timeout', async ({
    expect,
    closing,
  }) => {
    const peer = closing(createFakePeer());
    const pending = peer.connection.request('long', {}, { signal: AbortSignal.timeout(10) });
    await expect(pending).resolves.toStrictEqual(err({ kind: 'cancelled', method: 'long' }));
  });

  test('lets go of the signal once answered: a later abort sends no cancel', async ({
    expect,
    closing,
  }) => {
    const peer = closing(createFakePeer());
    const controller = new AbortController();
    const pending = peer.connection.request('quick', {}, { signal: controller.signal });
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 1, method: 'quick' });
    peer.send({ jsonrpc: '2.0', id: 1, result: 'done' });
    await expect(pending).resolves.toStrictEqual(ok('done'));
    controller.abort();
    expect(peer.sent).toStrictEqual([{ jsonrpc: '2.0', id: 1, method: 'quick', params: {} }]);
  });

  test('dispatches notifications and answers peer requests', async ({ expect, closing }) => {
    const notifications: unknown[] = [];
    const peer = closing(
      createFakePeer({
        onNotification: (method, params): void => {
          notifications.push({ method, params });
        },
        onRequest: (method, params) =>
          method === 'echo' ? ok(params) : err({ code: -32_601, message: `no ${method}` }),
      }),
    );
    peer.send({ jsonrpc: '2.0', method: 'hello', params: { a: 1 } });
    peer.send({ jsonrpc: '2.0', id: 'r1', method: 'echo', params: [1, 2] });
    await expect(peer.nextSent()).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'r1',
      result: [1, 2],
    });
    peer.send({ jsonrpc: '2.0', id: 'r2', method: 'other' });
    await expect(peer.nextSent()).resolves.toStrictEqual({
      jsonrpc: '2.0',
      id: 'r2',
      error: { code: -32_601, message: 'no other' },
    });
    expect(notifications).toStrictEqual([{ method: 'hello', params: { a: 1 } }]);
  });

  test('answers method-not-found without a handler, and internal-error when one throws', async ({
    expect,
    closing,
  }) => {
    const plain = closing(createFakePeer());
    plain.send({ jsonrpc: '2.0', id: 1, method: 'x' });
    await expect(plain.nextSent()).resolves.toMatchObject({ id: 1, error: { code: -32_601 } });

    const throwing = closing(
      createFakePeer({
        onRequest: (): never => {
          throw new Error('boom');
        },
      }),
    );
    throwing.send({ jsonrpc: '2.0', id: 2, method: 'x' });
    await expect(throwing.nextSent()).resolves.toMatchObject({ id: 2, error: { code: -32_603 } });
  });

  test('honours $/cancelRequest for peer requests', async ({ expect, closing }) => {
    let wasAborted = false;
    const peer = closing(
      createFakePeer({
        onRequest: async (_method, _params, signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              wasAborted = true;
              setTimeout(() => {
                resolve(ok('too late'));
              }, 5);
            });
          }),
      }),
    );
    peer.send({ jsonrpc: '2.0', id: 9, method: 'wait' });
    peer.send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 9 } });
    await expect(peer.nextSent()).resolves.toMatchObject({ id: 9, error: { code: -32_800 } });
    expect(wasAborted).toBe(true);
  });

  test('drops malformed messages and keeps going', async ({ expect, closing, signal }) => {
    const peer = closing(createFakePeer());
    const body = '{"jsonrpc":"1.0"}';
    peer.sendRaw(`Content-Length: ${String(body.length)}\r\n\r\n${body}`);
    const pending = peer.connection.request('still-alive', {}, { signal });
    await peer.nextSent();
    peer.send({ jsonrpc: '2.0', id: 1, result: true });
    await expect(pending).resolves.toStrictEqual(ok(true));
  });

  test('settles pending requests as closed when input ends, and refuses new work', async ({
    expect,
    closing,
    signal,
  }) => {
    const peer = closing(createFakePeer());
    const pending = peer.connection.request('a', {}, { signal });
    peer.endInput();
    await expect(pending).resolves.toStrictEqual(err({ kind: 'closed', method: 'a' }));
    expect(peer.closes).toStrictEqual([{ kind: 'input-ended' }]);
    await expect(peer.connection.request('b', {}, { signal })).resolves.toStrictEqual(
      err({ kind: 'closed', method: 'b' }),
    );
    expect(peer.connection.notify('c')).toStrictEqual(err({ kind: 'closed', method: 'c' }));
  });

  test('closes on a framing error', async ({ expect, closing, signal }) => {
    const peer = closing(createFakePeer());
    const pending = peer.connection.request('a', {}, { signal });
    peer.sendRaw('Bogus: header\r\n\r\n');
    await expect(pending).resolves.toStrictEqual(err({ kind: 'closed', method: 'a' }));
    expect(peer.closes).toMatchObject([
      { kind: 'framing-error', error: { kind: 'missing-content-length' } },
    ]);
  });
});
