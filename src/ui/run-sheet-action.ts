import type { BeuveApi, PermalinkView, SheetRangeView } from '#contract/ipc-contract.ts';

import type { StatusNotice } from './describe-editor-open.ts';
import { lineFromTarget } from './line-from-target.ts';
import { permalinkPlaceFrom } from './permalink-place-from.ts';
import { sheetRequestFrom } from './sheet-request-from.ts';
import type { SheetPlace } from './step-sheet-history.ts';
import type { ReviewTarget } from './target-from.ts';

/** `beuve-sheet-request`: a peek node's declaration to open at the head. */
export interface SheetOpenDetail {
  readonly path: string;
  readonly range: SheetRangeView;
}

/** What the main window asks of sheets and permalinks (ADR 0067). */
export type SheetAction =
  | { readonly kind: 'definition' | 'type-definition'; readonly target: ReviewTarget }
  | { readonly kind: 'copy-link' | 'open-link'; readonly target: ReviewTarget }
  /** A call-hierarchy node: open its declaration at the head. */
  | ({ readonly kind: 'open' } & SheetOpenDetail);

export interface SheetActionContext {
  readonly bridge: BeuveApi;
  readonly sessionId: string;
  readonly headSha: string;
  readonly baseSha: string;
  /** `/sheets window|inline` (ADR 0067). */
  readonly mode: 'window' | 'inline';
}

/** Either a status-bar notice, or a sheet for the main window's overlay to show. */
export type SheetOutcome =
  | { readonly kind: 'notice'; readonly notice: StatusNotice }
  | { readonly kind: 'inline'; readonly sha: string; readonly place: SheetPlace };

/**
 * Runs Go to Definition, Go to Type Definition, Copy GitHub Permalink, Open on GitHub and a peek node's "Open" from the main window
 * (ADR 0067): a definition at the target's head line (main picks the token) opens a new sheet
 * window, or the inline overlay; a permalink goes to the clipboard or the browser, for the
 * target's own side and lines. All IPC goes through `bridge`; main validates everything again.
 */
export async function runSheetAction(
  context: SheetActionContext,
  action: SheetAction,
): Promise<SheetOutcome> {
  switch (action.kind) {
    case 'definition':
    case 'type-definition': {
      return define(context, action.target, action.kind);
    }
    case 'copy-link':
    case 'open-link': {
      return link(context, action.target, action.kind === 'open-link');
    }
    case 'open': {
      return open(context, { path: action.path, range: action.range });
    }
  }
}

async function define(
  context: SheetActionContext,
  target: ReviewTarget,
  kind: 'definition' | 'type-definition',
): Promise<SheetOutcome> {
  const line = lineFromTarget(target);
  if (line === undefined || target.kind === 'change') {
    return info('Pick a line on the head side first (Go ▸ Next Change, or select lines).');
  }
  const answer = await context.bridge.invoke('lsp:definition', {
    sessionId: context.sessionId,
    sha: context.headSha,
    path: target.file.path,
    line,
    kind,
  });
  if (!answer.ok) {
    return { kind: 'notice', notice: { tone: 'error', text: answer.error.message } };
  }
  const request = sheetRequestFrom(context.sessionId, answer.value);
  return typeof request === 'string'
    ? info(request)
    : open({ ...context, headSha: request.sha }, { path: request.path, range: request.range });
}

async function open(context: SheetActionContext, place: SheetPlace): Promise<SheetOutcome> {
  if (context.mode === 'inline') {
    return { kind: 'inline', sha: context.headSha, place };
  }
  const opened = await context.bridge.invoke('sheet:open', {
    sessionId: context.sessionId,
    sha: context.headSha,
    path: place.path,
    ...(place.range !== undefined && { range: place.range }),
  });
  return opened.ok
    ? info(
        `Opened ${place.path}${place.range === undefined ? '' : `:${String(place.range.startLine)}`} in a sheet.`,
      )
    : { kind: 'notice', notice: { tone: 'error', text: opened.error.message } };
}

async function link(
  context: SheetActionContext,
  target: ReviewTarget,
  isOpening: boolean,
): Promise<SheetOutcome> {
  const place = permalinkPlaceFrom(target);
  if (place === undefined) {
    return info('Pick a file or lines to link to.');
  }
  const { side, ...where } = place;
  const request = {
    sessionId: context.sessionId,
    sha: side === 'base' ? context.baseSha : context.headSha,
    ...where,
  };
  const answer = await context.bridge.invoke(
    isOpening ? 'remote:open-permalink' : 'remote:permalink',
    request,
  );
  if (!answer.ok) {
    return { kind: 'notice', notice: { tone: 'error', text: answer.error.message } };
  }
  if (isOpening || answer.value.kind !== 'link') {
    return info(describeLink(answer.value, isOpening));
  }
  const copied = await context.bridge.invoke('clipboard:write-text', { text: answer.value.url });
  return copied.ok
    ? info(`Copied ${answer.value.url}`)
    : { kind: 'notice', notice: { tone: 'error', text: copied.error.message } };
}

function describeLink(link: PermalinkView, isOpening: boolean): string {
  return link.kind === 'link'
    ? `${isOpening ? 'Opened' : 'Link:'} ${link.url}`
    : 'This repository has no GitHub remote to link to.';
}

function info(text: string): SheetOutcome {
  return { kind: 'notice', notice: { tone: 'info', text } };
}
