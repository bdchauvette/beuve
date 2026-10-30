import type { SettingsInvokeChannel } from './ipc-contract.ts';
import { settingsOnlyInvokeChannels } from './settings-only-invoke-channels.ts';

/** Every channel the Settings window may invoke (ADR 0068), for its preload and for main. */
export const settingsInvokeChannels = Object.freeze([
  'display:get',
  'display:set',
  'editor:get-settings',
  'editor:set-preferred',
  'github:auth-status',
  'claude:status',
  'trace:list-trust',
  'trace:remove-trust',
  'menu:set-state',
  ...settingsOnlyInvokeChannels,
] as const satisfies readonly SettingsInvokeChannel[]);
