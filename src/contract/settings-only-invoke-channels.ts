import type { SettingsOnlyInvokeChannel } from './ipc-contract.ts';

/**
 * The channels only the Settings window may invoke (ADR 0070, 0111): the model registry, its keys
 * and its test, and opening the language server configuration. Main refuses them from the main window and sheets, and the main preload doesn't
 * forward them.
 */
export const settingsOnlyInvokeChannels = Object.freeze([
  'language-servers:open-config',
  'models:list',
  'models:save',
  'models:remove',
  'models:set-role',
  'models:set-key',
  'models:remove-key',
  'models:list-remote',
  'models:test',
] as const satisfies readonly SettingsOnlyInvokeChannel[]);
