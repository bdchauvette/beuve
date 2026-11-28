import type { SheetOnlyInvokeChannel } from './ipc-contract.ts';

/**
 * The channels only a sheet may invoke (ADR 0162): asking the main window for a note on a sheet's
 * lines. Main refuses them from the main window and Settings, and the main preload doesn't forward
 * them.
 */
export const sheetOnlyInvokeChannels = Object.freeze([
  'sheet:add-note',
] as const satisfies readonly SheetOnlyInvokeChannel[]);
