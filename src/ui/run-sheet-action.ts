import type { BeuveApi, PermalinkView, SheetRangeView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

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

/** A token the reviewer clicked in the diff: 1-based head line, 0-based UTF-16 column. */
export interface ClickedToken {
  readonly line: number;
  readonly character: number;
}

/** What the main window asks of sheets and permalinks (ADR 0067). */
export type SheetAction =
  | {
      readonly kind: 'definition' | 'type-definition';
      readonly target: ReviewTarget;
      /** The token the reviewer clicked, when it still stands: asked about instead of the target's line. */
      readonly token?: ClickedToken | undefined;
    }
  | { readonly kind: 'copy-link' | 'open-link'; readonly target: ReviewTarget }
  /** A call-hierarchy node: open its declaration at the head. */
  | ({ readonly kind: 'open' } & SheetOpenDetail);

export interface SheetActionContext {
  readonly bridge: BeuveApi;
  readonly sessionId: string;
  readonly headSha: string;
  readonly baseSha: string;
}

/**
 * Runs Go to Definition, Go to Type Definition, Copy GitHub Permalink, Open on GitHub and a peek node's "Open" from the main window
 * (ADR 0067): a definition at the target's head line (main picks the token) opens a new sheet
 * window; a permalink goes to the clipboard or the browser, for the
 * target's own side and lines. All IPC goes through `bridge`; main validates everything again.
 */
export async function runSheetAction(
  context: SheetActionContext,
  action: SheetAction,
): Promise<StatusNotice> {
  switch (action.kind) {
    case 'definition':
    case 'type-definition': {
      return define(context, action);
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
  action: DefinitionAction,
): Promise<StatusNotice> {
  const { target, token, kind } = action;
  if (target.kind === 'change') {
    return info('Pick a line on the head side first (Go ▸ Next Change, or select lines).');
  }
  const line = token?.line ?? lineFromTarget(target);
  if (line === undefined) {
    return info('Pick a line on the head side first (Go ▸ Next Change, or select lines).');
  }
  const answer = await context.bridge.invoke('lsp:definition', {
    sessionId: context.sessionId,
    sha: context.headSha,
    path: target.file.path,
    line,
    ...(token !== undefined && { character: token.character }),
    kind,
  });
  if (!answer.ok) {
    return { tone: 'error', text: answer.error.message };
  }
  const request = sheetRequestFrom(context.sessionId, answer.value);
  if (typeof request === 'string') {
    return info(request);
  }
  return open({ ...context, headSha: request.sha }, { path: request.path, range: request.range });
}

type DefinitionAction = Extract<SheetAction, { readonly kind: 'definition' | 'type-definition' }>;

async function open(context: SheetActionContext, place: SheetPlace): Promise<StatusNotice> {
  const opened = await context.bridge.invoke('sheet:open', {
    sessionId: context.sessionId,
    sha: context.headSha,
    path: place.path,
    ...(place.range !== undefined && { range: place.range }),
  });
  if (opened.ok) {
    return info(`Opened ${placeText(place)} in a sheet.`);
  }
  return { tone: 'error', text: opened.error.message };
}

async function link(
  context: SheetActionContext,
  target: ReviewTarget,
  isOpening: boolean,
): Promise<StatusNotice> {
  const place = permalinkPlaceFrom(target);
  if (place === undefined) {
    return info('Pick a file or lines to link to.');
  }
  const { side, ...where } = place;
  let sha = context.headSha;
  if (side === 'base') {
    sha = context.baseSha;
  }
  let channel: 'remote:permalink' | 'remote:open-permalink' = 'remote:permalink';
  if (isOpening) {
    channel = 'remote:open-permalink';
  }
  const answer = await context.bridge.invoke(channel, {
    sessionId: context.sessionId,
    sha,
    ...where,
  });
  if (!answer.ok) {
    return { tone: 'error', text: answer.error.message };
  }
  if (isOpening || answer.value.kind !== 'link') {
    return info(describeLink(answer.value, isOpening));
  }
  const copied = await context.bridge.invoke('clipboard:write-text', { text: answer.value.url });
  if (copied.ok) {
    return info(`Copied ${answer.value.url}`);
  }
  return { tone: 'error', text: copied.error.message };
}

/** The path, with the line a range starts on. */
function placeText(place: SheetPlace): string {
  const path = revealFormatControls(place.path);
  if (place.range === undefined) {
    return path;
  }
  return `${path}:${String(place.range.startLine)}`;
}

function describeLink(link: PermalinkView, isOpening: boolean): string {
  if (link.kind !== 'link') {
    return 'This repository has no GitHub remote to link to.';
  }
  if (isOpening) {
    return `Opened ${link.url}`;
  }
  return `Link: ${link.url}`;
}

function info(text: string): StatusNotice {
  return { tone: 'info', text };
}
