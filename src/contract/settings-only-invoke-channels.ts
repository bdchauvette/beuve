import type { SettingsOnlyInvokeChannel } from './ipc-contract.ts';

/**
 * The channels only the Settings window may invoke (ADR 0070): the model registry, its keys and
 * its test. Main refuses them from the main window and sheets, and the main preload doesn't
 * forward them.
 */
export const settingsOnlyInvokeChannels = Object.freeze([
  'models:list',
  'models:save',
  'models:remove',
  'models:set-role',
  'models:set-key',
  'models:remove-key',
  'models:list-remote',
  'models:test',
] as const satisfies readonly SettingsOnlyInvokeChannel[]);
