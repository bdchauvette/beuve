import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type {
  InvokeResponse,
  MenuRunView,
  SheetApi,
  SheetInvokeChannel,
} from '#contract/ipc-contract.ts';
import { isSheetInvokeChannel } from '#contract/is-sheet-invoke-channel.ts';

/**
 * A sheet window's only door to main (ADR 0067): `invoke` on the sheet channels, allow-listed
 * here and again in main, and the one event `menu:run` (ADR 0068) that carries its menu's
 * commands. No other channel, never `ipcRenderer` itself.
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
  onMenuRun: (listener: (payload: MenuRunView) => void): (() => void) => {
    if (typeof listener !== 'function') {
      throw new TypeError('expected a listener');
    }
    const forward = (_event: IpcRendererEvent, payload: MenuRunView): void => {
      listener(payload);
    };
    ipcRenderer.on('menu:run', forward);
    return (): void => {
      ipcRenderer.off('menu:run', forward);
    };
  },
};

contextBridge.exposeInMainWorld('beuve', Object.freeze(api));
