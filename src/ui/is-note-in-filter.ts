import type { UraItemView } from '#contract/ipc-contract.ts';

/** Which notes the notes list shows: all, the staged ones, the outdated ones or the closed ones. */
export type NoteFilter = 'all' | 'open' | 'outdated' | 'closed';

/**
 * Whether `item` belongs to `filter`. Open is staged, closed is addressed or withdrawn, and
 * outdated is any note whose lines no longer sit on the head, whatever its status.
 */
export function isNoteInFilter(item: UraItemView, filter: NoteFilter): boolean {
  switch (filter) {
    case 'all': {
      return true;
    }
    case 'open': {
      return item.status.kind === 'staged';
    }
    case 'outdated': {
      return item.placement.kind === 'outdated';
    }
    case 'closed': {
      return item.status.kind !== 'staged';
    }
  }
}
