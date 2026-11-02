import type { DiffFileView, UraItemView } from '#contract/ipc-contract.ts';

import type { MentionTarget } from './chat-draft.ts';
import { mentionTargetFromItem } from './mention-target-from-item.ts';
import type { PaletteAction } from './plan-palette.ts';

/** Options of {@link mentionTargetFromPalette}. */
export interface MentionTargetFromPaletteOptions {
  /** The palette's highlighted row, if any. */
  readonly action: PaletteAction | undefined;
  /** The review's staged notes, which a highlighted note row names by id. */
  readonly items: readonly UraItemView[];
  readonly files: readonly DiffFileView[];
}

const pickSomething = 'Pick a file or a staged note in the palette first.';

/**
 * What Add to Chat takes from the command palette (ADR 0046): the highlighted file, or the
 * highlighted staged note's lines; or a sentence saying what to pick. Pure.
 */
export function mentionTargetFromPalette(
  options: MentionTargetFromPaletteOptions,
): MentionTarget | string {
  const { action } = options;
  if (action?.kind === 'file') {
    return { path: action.path, side: 'head' };
  }
  if (action?.kind !== 'ura-item') {
    return pickSomething;
  }
  const item = options.items.find(({ id }) => id === action.itemId);
  if (item === undefined) {
    return pickSomething;
  }
  return mentionTargetFromItem(item, options.files);
}
