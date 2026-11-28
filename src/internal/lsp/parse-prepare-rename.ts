import { isLspRange } from './is-lsp-range.ts';
import type { LspRange } from './lsp-protocol.ts';

/**
 * A checked `textDocument/prepareRename` result (ADR 0163): the range to rename and the name to
 * offer, the server's word that the client should find the token itself (`default`), or that
 * nothing there can be renamed (`refused`, which `null` and every other shape mean).
 */
export type LspPrepareRename =
  | { readonly kind: 'range'; readonly range: LspRange; readonly placeholder: string | undefined }
  | { readonly kind: 'default' }
  | { readonly kind: 'refused' };

/** Longest placeholder kept; a server's longer one is no name anyone types. */
const maxPlaceholderLength = 1024;

/** Parses an untrusted `prepareRename` result: a `Range`, `{ range, placeholder }` or `{ defaultBehavior }`. */
export function parsePrepareRename(value: unknown): LspPrepareRename {
  if (isLspRange(value)) {
    return { kind: 'range', range: { start: value.start, end: value.end }, placeholder: undefined };
  }
  if (typeof value !== 'object' || value === null) {
    return { kind: 'refused' };
  }
  if ('defaultBehavior' in value && value.defaultBehavior === true) {
    return { kind: 'default' };
  }
  if (!('range' in value) || !isLspRange(value.range)) {
    return { kind: 'refused' };
  }
  let placeholder: string | undefined;
  if (
    'placeholder' in value &&
    typeof value.placeholder === 'string' &&
    value.placeholder.length <= maxPlaceholderLength
  ) {
    placeholder = value.placeholder;
  }
  const { start, end } = value.range;
  return { kind: 'range', range: { start, end }, placeholder };
}
