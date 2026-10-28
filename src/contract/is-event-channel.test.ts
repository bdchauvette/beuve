import { describe, expect, expectTypeOf, it } from 'vitest';

import { eventChannels } from './event-channels.ts';
import type { EventChannel } from './ipc-contract.ts';
import { isEventChannel } from './is-event-channel.ts';

describe('isEventChannel', () => {
  it('lists every event channel exactly once', () => {
    expectTypeOf<Exclude<EventChannel, (typeof eventChannels)[number]>>().toEqualTypeOf<never>();
    expect(new Set(eventChannels).size).toBe(eventChannels.length);
  });

  it('accepts only known channel names', () => {
    expect(isEventChannel('mcp:status')).toBe(true);
    expect(isEventChannel('app:get-info')).toBe(false);
  });
});
