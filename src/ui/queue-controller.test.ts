import { describe } from 'vitest';

import type { BeuveApi, ReviewQueueView } from '#contract/ipc-contract.ts';

import { QueueController } from './queue-controller.ts';
import { createFakeBridge } from './testing/create-fake-bridge.ts';
import { createFakeHost } from './testing/create-fake-host.ts';
import { createQueueItem } from './testing/create-queue-item.ts';
import { test } from './testing/test.ts';

function snapshot(isRefreshing: boolean): ReviewQueueView {
  return {
    items: [createQueueItem()],
    problems: [],
    refreshedAt: '2026-10-28T12:00:00Z',
    isRefreshing,
  };
}

describe('QueueController', () => {
  test('reads the queue, follows pushes while connected and refreshes on request', async ({
    expect,
  }) => {
    const fake = createFakeBridge({
      replies: {
        'queue:get': { ok: true, value: snapshot(true) },
        'queue:refresh': { ok: true, value: snapshot(false) },
      },
    });
    const { host, updates } = createFakeHost();
    const queue = new QueueController(host, {
      bridge: (): BeuveApi => {
        return fake.bridge;
      },
    });
    queue.hostConnected();
    await queue.load();
    expect(queue.queue?.isRefreshing).toBe(true);
    fake.emit('queue:updated', { ...snapshot(false), items: [] });
    expect(queue.queue?.items).toStrictEqual([]);
    await queue.refresh();
    expect(queue.queue?.items).toHaveLength(1);
    expect(fake.invoked.map(([channel]) => channel)).toStrictEqual(['queue:get', 'queue:refresh']);
    expect(updates()).toBe(4);
    queue.hostDisconnected();
    expect(fake.listening()).toBe(0);
  });

  test('keeps the last queue and says why when main refuses', async ({ expect }) => {
    const fake = createFakeBridge({
      replies: { 'queue:get': { ok: false, error: { code: 'internal', message: 'boom' } } },
    });
    const { host } = createFakeHost();
    const queue = new QueueController(host, { bridge: (): BeuveApi => fake.bridge });
    await queue.load();
    expect(queue.queue).toBeUndefined();
    expect(queue.error).toBe('boom');
  });
});
