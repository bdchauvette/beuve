import { describe, expect, expectTypeOf, it } from 'vitest';

import { invokeChannels } from './invoke-channels.ts';
import type { InvokeChannel } from './ipc-contract.ts';
import { isInvokeChannel } from './is-invoke-channel.ts';

describe('isInvokeChannel', () => {
  it('lists every invoke channel exactly once', () => {
    expectTypeOf<Exclude<InvokeChannel, (typeof invokeChannels)[number]>>().toEqualTypeOf<never>();
    expect(new Set(invokeChannels).size).toBe(invokeChannels.length);
  });

  it('accepts only known channel names', () => {
    expect(isInvokeChannel('session:list')).toBe(true);
    expect(isInvokeChannel('session:delete')).toBe(false);
    expect(isInvokeChannel(42)).toBe(false);
  });
});
