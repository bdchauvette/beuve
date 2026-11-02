import type { ClickedToken, SheetAction } from './run-sheet-action.ts';
import type { ReviewTarget } from './target-from.ts';

const sheetActionKinds = {
  'open-definition': 'definition',
  'open-type-definition': 'type-definition',
  'copy-permalink': 'copy-link',
  'open-permalink': 'open-link',
} as const;

/** The sheet action a menu command asks for; a definition asks about the clicked token, if any. */
export function sheetActionFrom(
  id: keyof typeof sheetActionKinds,
  target: ReviewTarget,
  token: ClickedToken | undefined,
): SheetAction {
  const kind = sheetActionKinds[id];
  if (kind === 'definition' || kind === 'type-definition') {
    return { kind, target, token };
  }
  return { kind, target };
}
