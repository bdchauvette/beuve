import type { SheetInvokeChannel } from './ipc-contract.ts';

/** Every channel a sheet window may invoke (ADR 0067), for its preload and for main. */
export const sheetInvokeChannels = Object.freeze([
  'lsp:definition',
  'lsp:hover',
  'sheet:open',
  'sheet:get-file',
  'sheet:get-head',
  'remote:permalink',
  'remote:open-permalink',
  'clipboard:write-text',
  'menu:set-state',
  'menu:context',
] as const satisfies readonly SheetInvokeChannel[]);
