import type { InvokeChannel } from './ipc-contract.ts';
import { invokeChannels } from './invoke-channels.ts';
import { settingsOnlyInvokeChannels } from './settings-only-invoke-channels.ts';

/** The channels the main window may invoke: every one but the Settings window's own (ADR 0070). */
export const mainWindowInvokeChannels: readonly InvokeChannel[] = Object.freeze(
  invokeChannels.filter((channel) => {
    return !(settingsOnlyInvokeChannels as readonly string[]).includes(channel);
  }),
);
