import { contextBridge, ipcRenderer } from 'electron';

import type { InvokeResponse, SheetApi, SheetInvokeChannel } from '#contract/ipc-contract.ts';
import { isSheetInvokeChannel } from '#contract/is-sheet-invoke-channel.ts';

/**
 * A sheet window's only door to main (ADR 0067): `invoke` on the sheet channels, allow-listed
 * here and again in main. No events, no other channel, never `ipcRenderer` itself.
 */
const api: SheetApi = {
  invoke: async <C extends SheetInvokeChannel>(
    channel: C,
    ...request: unknown[]
  ): Promise<InvokeResponse<C>> => {
    if (!isSheetInvokeChannel(channel)) {
      throw new TypeError(`unknown sheet channel: ${String(channel)}`);
    }
    return ipcRenderer.invoke(channel, ...request.slice(0, 1)) as Promise<InvokeResponse<C>>;
  },
};

contextBridge.exposeInMainWorld('beuve', Object.freeze(api));
