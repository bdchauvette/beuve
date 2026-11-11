import type {
  UraAnchorView,
  UraItemView,
  UraOriginView,
  UraOutdatedReasonView,
  UraSeverityView,
} from '#contract/ipc-contract.ts';
import { uraBlockingEmoji } from './ura-blocking-emoji.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';

/** How the dock and the diff markers label one URA item. */
export interface UraItemLabels {
  /** The label, with ` (blocking)` when the note blocks: `Issue (blocking)`. */
  readonly severity: string;
  /** The label's emoji, shown beside its name, after 🛑 when the note blocks. */
  readonly emoji: string;
  /** `src/a.ts:12-14`, where the item sits on the current head (or sat, when outdated). */
  readonly anchor: string;
  readonly origin: string;
  /** Why the item no longer maps onto the current head; absent while it does. */
  readonly outdated?: string;
}

const severities: Readonly<Record<UraSeverityView, string>> = {
  issue: 'Issue',
  suggestion: 'Suggestion',
  question: 'Question',
  nitpick: 'Nitpick',
  thought: 'Thought',
  smell: 'Smell',
  praise: 'Praise',
  note: 'Note',
  todo: 'Todo',
  chore: 'Chore',
};

const origins: Readonly<Record<UraOriginView['kind'], string>> = {
  human: 'human',
  'chat-answer': 'chat',
};

const outdatedReasons: Readonly<Record<UraOutdatedReasonView, string>> = {
  'lines-changed': 'outdated: the lines changed',
  'file-deleted': 'outdated: the file was deleted',
  'no-line-mapping': 'outdated: its head is gone',
};

/** Labels for an item: label and blocking, anchor on the current head, origin and outdated reason. */
export function describeUraItem(item: UraItemView): UraItemLabels {
  const { placement } = item;
  let severity = severities[item.severity];
  let emoji = uraSeverityEmoji(item.severity);
  if (item.blocking) {
    severity += ' (blocking)';
    emoji = `${uraBlockingEmoji} ${emoji}`;
  }
  return {
    severity,
    emoji,
    anchor: formatAnchor(currentAnchor(item)),
    origin: originOf(item),
    ...(placement.kind === 'outdated' && { outdated: outdatedReasons[placement.reason] }),
  };
}

/** Where the item sits on the current head, or where it was made when it no longer maps. */
function currentAnchor(item: UraItemView): UraAnchorView {
  if (item.placement.kind === 'current') {
    return item.placement.anchor;
  }
  return item.anchor;
}

function originOf(item: UraItemView): string {
  if (item.origin.kind === 'chat-answer' && item.origin.finding !== undefined) {
    return 'review finding';
  }
  return origins[item.origin.kind];
}

function formatAnchor(anchor: UraAnchorView): string {
  switch (anchor.kind) {
    case 'lines': {
      const { path, startLine, endLine } = anchor;
      if (startLine === endLine) {
        return `${path}:${String(startLine)}`;
      }
      return `${path}:${String(startLine)}-${String(endLine)}`;
    }
    case 'file': {
      return anchor.path;
    }
    case 'change': {
      return 'whole change';
    }
  }
}
