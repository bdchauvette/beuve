import { describe } from 'vitest';

import type { ChatStreamEvent } from '#contract/ipc-contract.ts';

import { textPartStream } from './text-part-stream.ts';
import type { ChatStreamSubscribe } from './text-part-stream.ts';
import { test } from './testing/test.ts';

/** A stand-in for the bridge's `chat:stream` subscription that the test pushes events into. */
interface FakeChannel {
  readonly subscribe: ChatStreamSubscribe;
  readonly push: (event: ChatStreamEvent) => void;
  readonly listeners: () => number;
}

/** Which part of which answer a delta extends. */
interface DeltaPlace {
  readonly partId: string;
  readonly messageId?: string;
}

function fakeChannel(): FakeChannel {
  const listeners = new Set<(event: ChatStreamEvent) => void>();
  return {
    subscribe: (listener): (() => void) => {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    push: (event): void => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    listeners: (): number => {
      return listeners.size;
    },
  };
}

function delta(text: string, { partId, messageId = 'a1' }: DeltaPlace): ChatStreamEvent {
  return { sessionId: 's1', messageId, type: 'text-delta', partId, text };
}

async function readAll(stream: ReadableStream<string>): Promise<string[]> {
  const chunks: string[] = [];
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    chunks.push(read.value);
  }
  return chunks;
}

describe('textPartStream', () => {
  test('yields one part’s deltas in order and closes when the part ends', async ({
    expect,
    signal,
  }) => {
    const channel = fakeChannel();
    const stream = textPartStream(channel.subscribe, {
      messageId: 'a1',
      partId: 'p2',
      initialText: 'It ',
      signal,
    });
    const read = readAll(stream);
    channel.push(delta('trims ', { partId: 'p2' }));
    channel.push(delta('other part', { partId: 'p3' }));
    channel.push(delta('other message', { partId: 'p2', messageId: 'a2' }));
    channel.push(delta('input.', { partId: 'p2' }));
    channel.push({
      sessionId: 's1',
      messageId: 'a1',
      type: 'part-end',
      part: { kind: 'text', id: 'p2', text: 'It trims input.' },
    });
    await expect(read).resolves.toStrictEqual(['It ', 'trims ', 'input.']);
    expect(channel.listeners()).toBe(0);
  });

  test('closes when the message ends, errors when the part is discarded', async ({
    expect,
    signal,
  }) => {
    const channel = fakeChannel();
    const ended = readAll(
      textPartStream(channel.subscribe, { messageId: 'a1', partId: 'p1', signal }),
    );
    const discarded = readAll(
      textPartStream(channel.subscribe, { messageId: 'a2', partId: 'p1', signal }),
    );
    channel.push(delta('Looking.', { partId: 'p1', messageId: 'a2' }));
    channel.push({ sessionId: 's1', messageId: 'a2', type: 'part-discard', partId: 'p1' });
    channel.push({
      sessionId: 's1',
      messageId: 'a1',
      type: 'message',
      message: {
        id: 'a1',
        sessionId: 's1',
        headSha: 'a'.repeat(40),
        role: 'assistant',
        parts: [],
        citations: [],
        status: 'cancelled',
        createdAt: '2026-10-28T12:00:00.000Z',
      },
    });
    await expect(ended).resolves.toStrictEqual([]);
    await expect(discarded).rejects.toThrow('discarded');
    expect(channel.listeners()).toBe(0);
  });

  test('stops listening when cancelled or aborted', async ({ expect, signal }) => {
    const channel = fakeChannel();
    const cancelled = textPartStream(channel.subscribe, { messageId: 'a1', partId: 'p1', signal });
    await cancelled.cancel();
    const controller = new AbortController();
    signal.addEventListener('abort', () => {
      controller.abort(signal.reason);
    });
    const aborted = readAll(
      textPartStream(channel.subscribe, {
        messageId: 'a1',
        partId: 'p1',
        signal: controller.signal,
      }),
    );
    controller.abort(new Error('closed'));
    await expect(aborted).rejects.toThrow('closed');
    expect(channel.listeners()).toBe(0);
  });
});
