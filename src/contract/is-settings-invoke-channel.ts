import type { SettingsInvokeChannel } from './ipc-contract.ts';
import { settingsInvokeChannels } from './settings-invoke-channels.ts';

/** Narrows an untrusted value to a channel the Settings window may invoke. */
export function isSettingsInvokeChannel(value: unknown): value is SettingsInvokeChannel {
  return typeof value === 'string' && (settingsInvokeChannels as readonly string[]).includes(value);
}
