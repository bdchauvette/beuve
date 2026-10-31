import type { ChatMessageView } from '#contract/ipc-contract.ts';

import { waitUntil } from '../../testing/wait-until.ts';

/** Waits for the update that ends `messageId`'s run: `done`, `error` or `cancelled`. */
export async function waitForSettled(
  updates: readonly ChatMessageView[],
  messageId: string,
): Promise<ChatMessageView> {
  const isSettled = (message: ChatMessageView): boolean => {
    return (
      message.id === messageId &&
      (message.status === 'done' || message.status === 'error' || message.status === 'cancelled')
    );
  };
  await waitUntil(() => {
    return updates.some((message) => isSettled(message));
  }, `answer ${messageId} to finish`);
  const settled = updates.find((message) => isSettled(message));
  if (settled === undefined) {
    throw new Error(`answer ${messageId} did not finish`);
  }
  return settled;
}
