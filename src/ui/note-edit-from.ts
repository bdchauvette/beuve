import type { UraAnchorView, UraItemView } from '#contract/ipc-contract.ts';

import type { UraDraftText } from './beuve-ura-composer.ts';
import { suggestionFieldsFrom } from './suggestion-fields-from.ts';
import type { SuggestionFieldView } from './suggestion-field-view.ts';

/** A staged note opened for editing in the diff: where its composer goes and what it starts with. */
export interface NoteEdit {
  readonly itemId: string;
  /** The head the note was written against, which its suggestions' lines are on. */
  readonly headSha: string;
  readonly anchor: Exclude<UraAnchorView, { readonly kind: 'change' }>;
  readonly draft: UraDraftText;
  /** The note's suggestions as fields, each keeping its id (ADR 0162). */
  readonly suggestions: readonly SuggestionFieldView[];
}

/**
 * What editing `item` in the diff starts from: its current lines or file, its label, blocking,
 * title and body, and its suggestions. Only a note the diff marks has one: staged, current on the
 * head, on a file.
 */
export function noteEditFrom(item: UraItemView): NoteEdit | undefined {
  const { placement } = item;
  if (item.status.kind !== 'staged' || placement.kind !== 'current') {
    return undefined;
  }
  const { anchor } = placement;
  if (anchor.kind === 'change') {
    return undefined;
  }
  return {
    itemId: item.id,
    headSha: item.headSha,
    anchor,
    draft: { severity: item.severity, blocking: item.blocking, title: item.title, body: item.body },
    suggestions: suggestionFieldsFrom(item),
  };
}
