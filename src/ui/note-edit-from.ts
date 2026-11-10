import type { UraAnchorView, UraItemView } from '#contract/ipc-contract.ts';

import type { UraDraft } from './beuve-ura-composer.ts';

/** A staged note opened for editing in the diff: where its composer goes and what it starts with. */
export interface NoteEdit {
  readonly itemId: string;
  readonly anchor: Exclude<UraAnchorView, { readonly kind: 'change' }>;
  readonly draft: UraDraft;
  /** The note's suggestion, previewed in the composer and left as it is by saving. */
  readonly suggestedPatch?: string;
}

/**
 * What editing `item` in the diff starts from: its current lines or file and its label, blocking,
 * title and body. Only a note the diff marks has one: staged, current on the head, on a file.
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
    anchor,
    draft: { severity: item.severity, blocking: item.blocking, title: item.title, body: item.body },
    ...(item.suggestedPatch !== undefined && { suggestedPatch: item.suggestedPatch }),
  };
}
