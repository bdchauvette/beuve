import type { SheetApi } from '#contract/ipc-contract.ts';

import './beuve-sheet-view.ts';

const query = new URLSearchParams(location.search);
const sheet = document.createElement('beuve-sheet-view');
// The sheet preload exposes only the sheet channels as `window.beuve` (ADR 0067).
sheet.api = (globalThis as unknown as { readonly beuve?: SheetApi }).beuve;
sheet.mode = 'window';
sheet.sessionId = query.get('session') ?? '';
sheet.sha = query.get('sha') ?? '';
sheet.place = { path: query.get('path') ?? '', range: rangeFrom(query) };
document.body.append(sheet);
sheet.focus();

function rangeFrom(
  params: URLSearchParams,
):
  { startLine: number; startCharacter: number; endLine: number; endCharacter: number } | undefined {
  const [startLine, startCharacter, endLine, endCharacter] = [
    'startLine',
    'startCharacter',
    'endLine',
    'endCharacter',
  ].map((name) => Math.trunc(Number(params.get(name) ?? NaN)));
  return startLine === undefined ||
    startCharacter === undefined ||
    endLine === undefined ||
    endCharacter === undefined ||
    [startLine, startCharacter, endLine, endCharacter].some((value) => Number.isNaN(value))
    ? undefined
    : { startLine, startCharacter, endLine, endCharacter };
}
