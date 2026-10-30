import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { anySignal } from './any-signal.ts';

describe('anySignal', () => {
  test('is undefined without signals and the signal itself for one', ({ expect, signal }) => {
    expect(anySignal()).toBeUndefined();
    expect(anySignal(undefined, undefined)).toBeUndefined();
    expect(anySignal(undefined, signal)).toBe(signal);
    expect(anySignal(signal, signal)).toBe(signal);
  });

  test('aborts when any of several aborts', ({ expect, signal }) => {
    const controller = new AbortController();
    const combined = anySignal(signal, undefined, controller.signal);
    expect(combined?.aborted).toBe(false);
    controller.abort();
    expect(combined?.aborted).toBe(true);
  });
});
