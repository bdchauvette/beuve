import type { ChatMessageView } from '#contract/ipc-contract.ts';

/** Whether a message's request is running now: taken from the queue and not yet ended. */
export function isActiveRequest(message: ChatMessageView): boolean {
  return message.status === 'submitted' || message.status === 'streaming';
}
