import type {
  UraAnchorView,
  UraItemView,
  UraOriginView,
  UraOutdatedReasonView,
  UraSeverityView,
} from '#contract/ipc-contract.ts';
import { uraBlockingEmoji } from './ura-blocking-emoji.ts';
import { uraSeverityEmoji } from './ura-severity-emoji.ts';

/** How the notes list and the diff markers label one URA item. */
export interface UraItemLabels {
  /** The label, with ` (blocking)` when the note blocks: `Issue (blocking)`. */
  readonly severity: string;
  /** The label alone: `Issue`, for its emoji's name in the notes list (ADR 0154). */
  readonly severityName: string;
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
  const severityName = severities[item.severity];
  let severity = severityName;
  let emoji = uraSeverityEmoji(item.severity);
  if (item.blocking) {
    severity += ' (blocking)';
    emoji = `${uraBlockingEmoji} ${emoji}`;
  }
  return {
    severity,
    severityName,
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

/** `review finding · 80%` when a finding kept its confidence (ADR 0143). */
function originOf({ origin }: UraItemView): string {
  if (origin.kind !== 'chat-answer' || origin.finding === undefined) {
    return origins[origin.kind];
  }
  if (origin.confidence === undefined) {
    return 'review finding';
  }
  return `review finding · ${String(Math.round(origin.confidence * 100))}%`;
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
