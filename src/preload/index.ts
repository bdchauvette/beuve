import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type {
  BeuveApi,
  EventChannel,
  EventPayload,
  InvokeChannel,
  InvokeResponse,
} from '#contract/ipc-contract.ts';
import { isEventChannel } from '#contract/is-event-channel.ts';
import { isInvokeChannel } from '#contract/is-invoke-channel.ts';

/**
 * The renderer's only door to main: contract channels, allow-listed at runtime because the
 * page is untrusted. `ipcRenderer` itself and event objects never cross the bridge.
 */
const api: BeuveApi = {
  invoke: async <C extends InvokeChannel>(
    channel: C,
    ...request: unknown[]
  ): Promise<InvokeResponse<C>> => {
    if (!isInvokeChannel(channel)) {
      throw new TypeError(`unknown invoke channel: ${String(channel)}`);
    }
    return ipcRenderer.invoke(channel, ...request.slice(0, 1)) as Promise<InvokeResponse<C>>;
  },
  on: <E extends EventChannel>(
    channel: E,
    listener: (payload: EventPayload<E>) => void,
  ): (() => void) => {
    if (typeof listener !== 'function' || !isEventChannel(channel)) {
      throw new TypeError('expected a contract event channel and a listener');
    }
    const forward = (_event: IpcRendererEvent, payload: EventPayload<E>): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, forward);
    return (): void => {
      ipcRenderer.off(channel, forward);
    };
  },
};

contextBridge.exposeInMainWorld('beuve', Object.freeze(api));
