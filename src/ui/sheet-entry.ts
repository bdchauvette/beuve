import type { SheetApi, SheetRangeView } from '#contract/ipc-contract.ts';

import type { CommandId } from '#contract/command-catalog.ts';

import './beuve-sheet-view.ts';
import { keyPlatformOf } from './key-platform-of.ts';
import { shortcutOf } from './shortcut-of.ts';
import { installTrustedTypesPolicy } from './install-trusted-types-policy.ts';

// Before the first render: the libraries' HTML goes through the default policy (ADR 0077).
installTrustedTypesPolicy();

const query = new URLSearchParams(location.search);
const sheet = document.createElement('beuve-sheet-view');
// The sheet preload exposes only the sheet channels as `window.beuve` (ADR 0067).
const api = (globalThis as unknown as { readonly beuve?: SheetApi }).beuve;
sheet.api = api;
sheet.shortcuts = {
  back: shortcut('back'),
  forward: shortcut('forward'),
  copyLink: shortcut('copy-permalink'),
};
// The window's menu bar (and on macOS the app menu while this window is focused) runs these.
api?.onMenuRun?.(({ id }) => {
  sheet.runCommand(id);
});
sheet.mode = 'window';
sheet.sessionId = query.get('session') ?? '';
sheet.sha = query.get('sha') ?? '';
sheet.place = { path: query.get('path') ?? '', range: rangeFrom(query) };
document.body.append(sheet);
sheet.focus();

function shortcut(id: CommandId): string {
  return shortcutOf(id, keyPlatformOf(navigator.platform));
}

function rangeFrom(params: URLSearchParams): SheetRangeView | undefined {
  const [startLine, startCharacter, endLine, endCharacter] = [
    'startLine',
    'startCharacter',
    'endLine',
    'endCharacter',
  ].map((name) => Math.trunc(Number(params.get(name) ?? NaN)));
  if (
    startLine === undefined ||
    startCharacter === undefined ||
    endLine === undefined ||
    endCharacter === undefined ||
    [startLine, startCharacter, endLine, endCharacter].some((value) => Number.isNaN(value))
  ) {
    return undefined;
  }
  return { startLine, startCharacter, endLine, endCharacter };
}
