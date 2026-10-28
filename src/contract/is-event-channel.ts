import { eventChannels } from './event-channels.ts';
import type { EventChannel } from './ipc-contract.ts';

/** Narrows an untrusted value to a known push channel name. */
export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (eventChannels as readonly string[]).includes(value);
}
