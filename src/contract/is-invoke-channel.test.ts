import { describe, expectTypeOf } from 'vitest';

import { test } from '#testing/test.ts';

import { invokeChannels } from './invoke-channels.ts';
import type { InvokeChannel } from './ipc-contract.ts';
import { isInvokeChannel } from './is-invoke-channel.ts';

describe('isInvokeChannel', () => {
  test('lists every invoke channel exactly once', ({ expect }) => {
    expectTypeOf<Exclude<InvokeChannel, (typeof invokeChannels)[number]>>().toEqualTypeOf<never>();
    expect(new Set(invokeChannels).size).toBe(invokeChannels.length);
  });

  test('accepts only known channel names', ({ expect }) => {
    expect(isInvokeChannel('session:list')).toBe(true);
    expect(isInvokeChannel('session:delete')).toBe(false);
    expect(isInvokeChannel(42)).toBe(false);
  });
});
