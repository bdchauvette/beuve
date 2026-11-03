import { describe, expectTypeOf } from 'vitest';

import { test } from '#testing/test.ts';

import { eventChannels } from './event-channels.ts';
import type { EventChannel } from './ipc-contract.ts';
import { isEventChannel } from './is-event-channel.ts';

describe('isEventChannel', () => {
  test('lists every event channel exactly once', ({ expect }) => {
    expectTypeOf<Exclude<EventChannel, (typeof eventChannels)[number]>>().toEqualTypeOf<never>();
    expect(new Set(eventChannels).size).toBe(eventChannels.length);
  });

  test('accepts only known channel names', ({ expect }) => {
    expect(isEventChannel('chat:stream')).toBe(true);
    expect(isEventChannel('app:get-info')).toBe(false);
  });
});
