import type { SettingsOnlyInvokeChannel } from './ipc-contract.ts';

/**
 * The channels only the Settings window may invoke (ADR 0070, 0111, 0139): the model registry, its
 * keys and its test, opening the language server configuration and `settings.json`, and choosing the editor (a setting only, ADR 0139). Main refuses them from the main window and sheets, and the main preload doesn't
 * forward them.
 */
export const settingsOnlyInvokeChannels = Object.freeze([
  'language-servers:open-config',
  'editor:open-settings-file',
  'editor:set-preferred',
  'models:list',
  'models:save',
  'models:remove',
  'models:set-role',
  'models:set-key',
  'models:remove-key',
  'models:list-remote',
  'models:test',
] as const satisfies readonly SettingsOnlyInvokeChannel[]);
