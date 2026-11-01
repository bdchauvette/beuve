import { test } from '#testing/test.ts';

import { OutputCoalescer } from './output-coalescer.ts';

test('joins writes into one flush after the delay', async ({ expect }) => {
  const { promise, resolve } = Promise.withResolvers<string>();
  using coalescer = new OutputCoalescer({
    delay: Temporal.Duration.from({ milliseconds: 5 }),
    limit: 1000,
    flush: resolve,
  });
  coalescer.write('a');
  coalescer.write('b');
  coalescer.write('c');
  await expect(promise).resolves.toBe('abc');
});

test('flushes at once past the limit', ({ expect }) => {
  const flushed: string[] = [];
  using coalescer = new OutputCoalescer({
    delay: Temporal.Duration.from({ seconds: 60 }),
    limit: 4,
    flush: (text): void => {
      flushed.push(text);
    },
  });
  coalescer.write('ab');
  coalescer.write('cd');
  expect(flushed).toStrictEqual(['abcd']);
});

test('flushes what is waiting when disposed, and then nothing more', ({ expect }) => {
  const flushed: string[] = [];
  {
    using coalescer = new OutputCoalescer({
      delay: Temporal.Duration.from({ seconds: 60 }),
      limit: 100,
      flush: (text): void => {
        flushed.push(text);
      },
    });
    coalescer.write('tail');
  }
  expect(flushed).toStrictEqual(['tail']);
});
