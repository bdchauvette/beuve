import { invokeChannels } from './invoke-channels.ts';
import type { InvokeChannel } from './ipc-contract.ts';

/** Narrows an untrusted value to a known invoke channel name. */
export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (invokeChannels as readonly string[]).includes(value);
}
