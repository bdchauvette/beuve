import type { ChatMessageView } from '#contract/ipc-contract.ts';

import { waitUntil } from '../../testing/wait-until.ts';

/** Waits for the update that ends `messageId`'s run: anything but queued or streaming. */
export async function waitForSettled(
  updates: readonly ChatMessageView[],
  messageId: string,
): Promise<ChatMessageView> {
  const isSettled = (message: ChatMessageView): boolean =>
    message.id === messageId && message.status !== 'queued' && message.status !== 'streaming';
  await waitUntil(
    () => updates.some((message) => isSettled(message)),
    `answer ${messageId} to finish`,
  );
  const settled = updates.find((message) => isSettled(message));
  if (settled === undefined) {
    throw new Error(`answer ${messageId} did not finish`);
  }
  return settled;
}
