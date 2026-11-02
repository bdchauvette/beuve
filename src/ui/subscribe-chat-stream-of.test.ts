import { describe } from 'vitest';

import type { BeuveApi } from '#contract/ipc-contract.ts';

import { subscribeChatStreamOf } from './subscribe-chat-stream-of.ts';
import { test } from './testing/test.ts';

function noop(): void {
  return;
}

describe('subscribeChatStreamOf', () => {
  test('has no subscription without the bridge', ({ expect }) => {
    expect(subscribeChatStreamOf(undefined)).toBeUndefined();
  });

  test('subscribes to chat:stream and hands back the unsubscribe', ({ expect }) => {
    const seen: string[] = [];
    const bridge = {
      on: (channel: string): (() => void) => {
        seen.push(channel);
        return (): void => {
          seen.push('off');
        };
      },
    } as unknown as BeuveApi;
    const unsubscribe = subscribeChatStreamOf(bridge)?.(noop);
    unsubscribe?.();
    expect(seen).toStrictEqual(['chat:stream', 'off']);
  });
});
