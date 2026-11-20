import type { UraItemView, UraOutdatedReasonView } from '#contract/ipc-contract.ts';

/** One marked fact about a note, as its row in the notes list says it (ADR 0154). */
export interface NoteMark {
  readonly kind: 'blocking' | 'outdated' | 'posted' | 'addressed' | 'withdrawn';
  /** The word the row shows. */
  readonly text: string;
  /** What the word's tooltip adds. */
  readonly title: string;
}

const outdatedReasons: Readonly<Record<UraOutdatedReasonView, string>> = {
  'lines-changed': 'The lines changed',
  'file-deleted': 'The file was deleted',
  'no-line-mapping': 'Its head is gone',
};

/**
 * The facts about a note that differ from the default, in the order the row shows them: Blocking,
 * Outdated, Posted, then Addressed or Withdrawn (ADR 0154). A note you would write and leave alone
 * (open, current, not posted, not blocking) has none. Whether an agent wrote it is the separate ✨.
 * Pure.
 */
export function noteMarksFrom(item: UraItemView): NoteMark[] {
  const marks: NoteMark[] = [];
  if (item.blocking) {
    marks.push({
      kind: 'blocking',
      text: 'Blocking',
      title: 'Approving is refused while this note is open',
    });
  }
  if (item.placement.kind === 'outdated') {
    marks.push({
      kind: 'outdated',
      text: 'Outdated',
      title: `${outdatedReasons[item.placement.reason]}. It is still exported, with the lines it was written on (${item.headSha.slice(0, 7)}).`,
    });
  }
  if (item.posted !== undefined) {
    let where = 'in the review body';
    if (item.posted.placement === 'inline') {
      where = 'inline';
    }
    marks.push({ kind: 'posted', text: 'Posted', title: `Posted to GitHub ${where}` });
  }
  if (item.status.kind === 'addressed') {
    let by = 'you';
    if (item.status.by === 'agent') {
      by = 'an agent';
    }
    marks.push({
      kind: 'addressed',
      text: 'Addressed',
      title: `Marked addressed by ${by} at ${item.status.atSha.slice(0, 7)}`,
    });
  } else if (item.status.kind === 'withdrawn') {
    marks.push({ kind: 'withdrawn', text: 'Withdrawn', title: 'Withdrawn: not exported' });
  }
  return marks;
}
