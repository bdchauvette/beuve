import type {
  ChatCitationView,
  ChatMentionView,
  UraExportTarget,
  UraItemView,
  UraVerdictView,
} from '#contract/ipc-contract.ts';

import type { MentionTarget } from './chat-draft.ts';
import type { PaletteAction } from './plan-palette.ts';
import type { RadarTreeMode } from './plan-radar-tree.ts';

/** The `detail` of each event the app's children emit, as the app reads it. */

/** The file the diff stream is on, if any. */
export interface ActiveFileDetail {
  readonly path: string | undefined;
}

/** Lines a diff card adds to the chat. */
export interface ChatAddDetail {
  readonly target: MentionTarget;
}

/** A citation pill to open. */
export interface ChatCiteDetail {
  readonly citation: ChatCitationView;
}

/** A context chip to show in the diff. */
export interface ChatMentionDetail {
  readonly mention: ChatMentionView;
}

/** A question and its context chips. */
export interface ChatSubmitDetail {
  readonly text: string;
  readonly mentions?: readonly ChatMentionView[];
}

/** A file and line to open in the editor. */
export interface EditorOpenDetail {
  readonly path: string;
  readonly line: number;
}

/** A file to mark reviewed, or to unmark. */
export interface FileReviewedDetail {
  readonly path: string;
  readonly reviewed: boolean;
}

/** One finding of a `/review` answer: its message and its index. */
export interface FindingRefDetail {
  readonly messageId: string;
  readonly finding: number;
}

/** One note an answer proposed (ADR 0132): its message and its index. */
export interface ProposalRefDetail {
  readonly messageId: string;
  readonly proposal: number;
}

/** A button of the dock's review-edits section (ADR 0088). */
export interface ReviewEditsDetail {
  readonly op: string;
}

/** A file and, if any, the line a portal opens at. */
export interface LineRequestDetail {
  readonly path: string;
  readonly line: number | undefined;
}

/** A chat message, by id. */
export interface MessageIdDetail {
  readonly messageId: string;
}

/** The palette entry the reviewer ran. */
export interface PaletteRunDetail {
  readonly action: PaletteAction;
}

/** A call hierarchy node to expand. */
export interface PeekExpandDetail {
  readonly nodeId: string;
}

/** A session the open panel or the palette picked. */
export interface SessionIdDetail {
  readonly sessionId: string;
}

/** A stacked pull request, by its ref. */
export interface StackRefDetail {
  readonly ref: string;
}

/** The radar tree mode chosen in its header. */
export interface TreeModeDetail {
  readonly mode: RadarTreeMode;
}

/** A file picked in the radar tree. */
export interface TreeSelectDetail {
  readonly path: string;
}

/** Where to export the staged review. */
export interface UraExportDetail {
  readonly target: UraExportTarget;
}

/** A staged item, by id. */
export interface UraItemIdDetail {
  readonly itemId: string;
}

/** A staged item to show in the diff. */
export interface UraJumpDetail {
  readonly item: UraItemView;
}

/** The dock order after a move. */
export interface UraReorderDetail {
  readonly itemIds: readonly string[];
}

/** A staged item and the status it moves to. */
export interface UraTransitionDetail {
  readonly itemId: string;
  readonly to: 'staged' | 'withdrawn' | 'addressed';
}

/** The verdict the reviewer chose; `undefined` goes back to the derived one. */
export interface UraVerdictDetail {
  readonly verdict: UraVerdictView | undefined;
}

/** A link to open. */
export interface UrlDetail {
  readonly url: string;
}
