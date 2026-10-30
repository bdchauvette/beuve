import type { SheetInvokeChannel } from './ipc-contract.ts';
import { sheetInvokeChannels } from './sheet-invoke-channels.ts';

/** Narrows an untrusted value to a channel a sheet window may invoke. */
export function isSheetInvokeChannel(value: unknown): value is SheetInvokeChannel {
  return typeof value === 'string' && (sheetInvokeChannels as readonly string[]).includes(value);
}
