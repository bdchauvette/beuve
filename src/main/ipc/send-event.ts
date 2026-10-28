import type { WebContents } from 'electron';

import type { EventChannel, EventPayload } from '../../contract/ipc-contract.ts';

/** Pushes a typed contract event to one renderer, ignoring destroyed ones. */
export function sendEvent<E extends EventChannel>(
  contents: WebContents,
  channel: E,
  payload: EventPayload<E>,
): void {
  if (!contents.isDestroyed()) {
    contents.send(channel, payload);
  }
}
