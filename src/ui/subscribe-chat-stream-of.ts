import type { BeuveApi } from '#contract/ipc-contract.ts';

import type { ChatStreamSubscribe } from './text-part-stream.ts';

/** The bridge's `chat:stream` subscription, as `textPartStream` takes it. */
export function subscribeChatStreamOf(
  bridge: BeuveApi | undefined,
): ChatStreamSubscribe | undefined {
  if (bridge === undefined) {
    return undefined;
  }
  return (listener): (() => void) => bridge.on('chat:stream', listener);
}
