import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { untilAborted } from './until-aborted.ts';

describe('untilAborted', () => {
  test('answers the work when it settles first', async ({ expect, signal }) => {
    await expect(untilAborted(Promise.resolve(7), signal)).resolves.toBe(7);
  });

  test('answers aborted when the signal aborts first, and the work goes on', async ({
    expect,
    signal,
  }) => {
    const work = Promise.withResolvers<number>();
    const controller = new AbortController();
    const waiting = untilAborted(work.promise, AbortSignal.any([signal, controller.signal]));
    controller.abort();
    await expect(waiting).resolves.toBe('aborted');
    work.resolve(7);
    await expect(work.promise).resolves.toBe(7);
  });

  test('answers aborted at once for an aborted signal', async ({ expect, signal }) => {
    const never = Promise.withResolvers<number>().promise;
    const aborted = AbortSignal.any([signal, AbortSignal.abort()]);
    await expect(untilAborted(never, aborted)).resolves.toBe('aborted');
  });
});
