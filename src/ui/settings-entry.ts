import type { SettingsApi } from '#contract/ipc-contract.ts';

import './beuve-settings-view.ts';

const view = document.createElement('beuve-settings-view');
// The Settings preload exposes only the settings channels as `window.beuve` (ADR 0068).
view.api = (globalThis as unknown as { readonly beuve?: SettingsApi }).beuve;
if (navigator.platform.startsWith('Mac')) {
  document.title = 'Settings';
} else {
  document.title = 'Preferences';
}
document.body.append(view);
