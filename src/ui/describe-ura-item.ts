import type {
  UraAnchorView,
  UraItemView,
  UraOriginView,
  UraOutdatedReasonView,
  UraSeverityView,
} from '#contract/ipc-contract.ts';

/** How the dock and the diff markers label one URA item. */
export interface UraItemLabels {
  readonly severity: string;
  /** `src/a.ts:12-14`, where the item sits on the current head (or sat, when outdated). */
  readonly anchor: string;
  readonly origin: string;
  /** Why the item no longer maps onto the current head; absent while it does. */
  readonly outdated?: string;
}

const severities: Readonly<Record<UraSeverityView, string>> = {
  blocker: 'Blocker',
  issue: 'Issue',
  question: 'Question',
  nit: 'Nit',
  praise: 'Praise',
};

const origins: Readonly<Record<UraOriginView['kind'], string>> = {
  human: 'human',
  'impact-finding': 'ImpactGate',
  'chat-answer': 'chat',
};

const outdatedReasons: Readonly<Record<UraOutdatedReasonView, string>> = {
  'lines-changed': 'outdated: the lines changed',
  'file-deleted': 'outdated: the file was deleted',
  'no-line-mapping': 'outdated: its head is gone',
};

/** Labels for an item: severity, anchor on the current head, origin and outdated reason. */
export function describeUraItem(item: UraItemView): UraItemLabels {
  const { placement } = item;
  return {
    severity: severities[item.severity],
    anchor: formatAnchor(placement.kind === 'current' ? placement.anchor : item.anchor),
    origin:
      item.origin.kind === 'chat-answer' && item.origin.finding !== undefined
        ? 'review finding'
        : origins[item.origin.kind],
    ...(placement.kind === 'outdated' && { outdated: outdatedReasons[placement.reason] }),
  };
}

function formatAnchor(anchor: UraAnchorView): string {
  switch (anchor.kind) {
    case 'lines': {
      const { path, startLine, endLine } = anchor;
      return startLine === endLine
        ? `${path}:${String(startLine)}`
        : `${path}:${String(startLine)}-${String(endLine)}`;
    }
    case 'file': {
      return anchor.path;
    }
    case 'change': {
      return 'whole change';
    }
  }
}
