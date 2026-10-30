import { describe } from 'vitest';

import { readServerSentEvents } from './read-server-sent-events.ts';
import { test } from '#testing/test.ts';

function chunksOf(...parts: readonly string[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return parts.map((part) => encoder.encode(part));
}

async function collect(source: AsyncIterable<string>): Promise<string[]> {
  const events: string[] = [];
  // eslint-disable-next-line unicorn/prefer-array-from-async -- Array.fromAsync is not in the ES2024 lib.
  for await (const event of source) {
    events.push(event);
  }
  return events;
}

describe('readServerSentEvents', () => {
  test('yields each data payload, across chunk and line-ending boundaries', async ({ expect }) => {
    const chunks = chunksOf(
      ': comment\n',
      'data: {"a"',
      ':1}\r\n\r\nevent: x\nda',
      'ta: two\ndata:  lines\n\n',
      'data: [DONE]',
    );
    const events = await collect(readServerSentEvents(chunks, 1000));
    expect(events).toStrictEqual(['{"a":1}', 'two\n lines', '[DONE]']);
  });

  test('skips events without data and splits a multi-byte character safely', async ({ expect }) => {
    const bytes = new TextEncoder().encode('data: é\n\n');
    const empty = await collect(readServerSentEvents(chunksOf('id: 1\n\n'), 100));
    const split = await collect(readServerSentEvents([bytes.slice(0, 7), bytes.slice(7)], 100));
    expect(empty).toStrictEqual([]);
    expect(split).toStrictEqual(['é']);
  });

  test('throws past the byte limit', async ({ expect }) => {
    const chunks = chunksOf('data: 1234567890\n\n', 'data: x\n\n');
    await expect(collect(readServerSentEvents(chunks, 12))).rejects.toThrow(RangeError);
  });
});
