import { contextBridge, ipcRenderer } from 'electron';

import type { InvokeResponse, SettingsApi, SettingsInvokeChannel } from '#contract/ipc-contract.ts';
import { isSettingsInvokeChannel } from '#contract/is-settings-invoke-channel.ts';

/**
 * The Settings window's only door to main (ADR 0068): `invoke` on the settings channels,
 * allow-listed here and again in main. No events, no other channel, never `ipcRenderer` itself.
 */
const api: SettingsApi = {
  invoke: async <C extends SettingsInvokeChannel>(
    channel: C,
    ...request: unknown[]
  ): Promise<InvokeResponse<C>> => {
    if (!isSettingsInvokeChannel(channel)) {
      throw new TypeError(`unknown settings channel: ${String(channel)}`);
    }
    return ipcRenderer.invoke(channel, ...request.slice(0, 1)) as Promise<InvokeResponse<C>>;
  },
};

contextBridge.exposeInMainWorld('beuve', Object.freeze(api));
