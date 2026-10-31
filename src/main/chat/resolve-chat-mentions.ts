import type { ChatMentionView, IpcError } from '#contract/ipc-contract.ts';
import type { ChatMention, CommitSha } from '#internal/chat/chat-message.ts';
import type { ChatSelection } from '#internal/chat/chat-question.ts';
import { excerptLines } from '#internal/chat/excerpt-lines.ts';
import { formatMention } from '#internal/chat/format-mention.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { findTreeBlob } from '#internal/git/find-tree-blob.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import type { ReviewDiff } from '../sessions/load-review-diff.ts';
import type { SessionContext } from '../sessions/session-context.ts';
import { headPathOf } from '../sessions/head-path-of.ts';

/** The mentions as stored with the question, and their text for the prompt, in the same order. */
export interface ResolvedMentions {
  readonly mentions: readonly ChatMention[];
  readonly selections: readonly ChatSelection[];
}

/** Lines all of a question's mentions may span together, whole files counted by their length. */
const maxMentionLines = 20_000;

const maxBlobBytes = 2 * 1024 * 1024;
const zeroId = /^0+$/u;

/**
 * Reads each mention's exact text at its commit (ADR 0046). A head mention must name the session
 * head and a base mention the review's base; the path must be that side's in the diff (read by
 * its blob, so an interdiff's base side is what the card shows) or tracked at that commit.
 * Anything else, a start past the end of the file, or more than 20 000 lines in all is refused
 * with a message the drawer shows. Binary, oversized and submodule files resolve to an
 * `unreadable` selection the prompt names.
 */
export async function resolveChatMentions(
  context: SessionContext,
  diff: ReviewDiff,
  requested: readonly ChatMentionView[],
): Promise<Result<ResolvedMentions, IpcError>> {
  const { repository, session } = diff.refreshed;
  const shas = { head: session.headSha, base: diff.baseSha };
  const trackedBlob = async (
    side: ChatMentionView['side'],
    path: string,
  ): Promise<Result<string | undefined, IpcError>> => {
    const found = await findTreeBlob(repository, shas[side], path);
    if (found.ok) {
      return ok(found.value?.objectId);
    }
    return gitFailure(context.logger, found.error);
  };

  const objectIds: string[] = [];
  for (const mention of requested) {
    const expected = shas[mention.side];
    if (mention.sha !== expected) {
      return refuse(
        `${formatMention(mention)} was selected at ${mention.sha.slice(0, 8)}, but the review's ${mention.side} is now ${expected.slice(0, 8)}. Add it again.`,
      );
    }
    let objectId = blobInDiff(diff.files, mention);
    if (objectId === undefined) {
      const tracked = await trackedBlob(mention.side, mention.path);
      if (!tracked.ok) {
        return tracked;
      }
      objectId = tracked.value;
    }
    if (objectId === undefined) {
      return refuse(
        `${mention.path} is neither in the review nor tracked at ${mention.side} ${expected.slice(0, 8)}.`,
      );
    }
    objectIds.push(objectId);
  }
  const blobs = await readBlobs(
    repository,
    objectIds.map((objectId) => {
      return { objectId };
    }),
    { maxBlobBytes },
  );
  if (!blobs.ok) {
    return gitFailure(context.logger, blobs.error);
  }

  const mentions: ChatMention[] = [];
  const selections: ChatSelection[] = [];
  let totalLines = 0;
  for (const [index, mention] of requested.entries()) {
    const sha = mention.sha as CommitSha;
    const where = { path: mention.path, side: mention.side, sha };
    const content = blobs.value.get(objectIds[index] ?? '');
    if (
      content?.kind === 'binary' ||
      content?.kind === 'too-large' ||
      content?.kind === 'submodule'
    ) {
      mentions.push(storedMention(where, mention, lines(mention)));
      selections.push({ ...where, kind: 'unreadable', reason: content.kind });
      continue;
    }
    if (content?.kind !== 'text') {
      return refuse(`${mention.path} could not be read at ${mention.side} ${sha.slice(0, 8)}.`);
    }
    const excerpt = excerptLines(content.text, mention);
    if (!excerpt.ok) {
      return refuse(
        `${formatMention(mention)} starts past the end of the file (${String(excerpt.error.totalLines)} lines).`,
      );
    }
    totalLines += excerpt.value.lines.length;
    if (totalLines > maxMentionLines) {
      return refuse(
        `The selections span more than ${String(maxMentionLines)} lines. Attach fewer or smaller ones.`,
      );
    }
    const { startLine, endLine } = excerpt.value;
    mentions.push(storedMention(where, mention, { startLine, endLine }));
    selections.push({ ...where, kind: 'lines', ...excerpt.value });
  }
  return ok({ mentions, selections });
}

/** A mention's lines: inclusive and 1-based. */
interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/** One side of a diff file: its path there, whether it exists, and its blob. */
interface DiffSide {
  readonly path: string;
  readonly isAbsent: boolean;
  readonly objectId: string | undefined;
}

/** The mention as stored: the whole file when it names no lines, else `range` of it. */
function storedMention(
  where: ChatMention,
  mention: ChatMentionView,
  range: LineRange,
): ChatMention {
  if (mention.startLine === undefined) {
    return where;
  }
  return { ...where, ...range };
}

function blobInDiff(files: readonly DiffFile[], mention: ChatMentionView): string | undefined {
  for (const file of files) {
    const { path, isAbsent, objectId } = diffSideOf(file, mention.side);
    if (!isAbsent && objectId !== undefined && path === mention.path && !zeroId.test(objectId)) {
      return objectId;
    }
  }
  return undefined;
}

function diffSideOf(file: DiffFile, side: ChatMentionView['side']): DiffSide {
  if (side === 'head') {
    return {
      path: headPathOf(file),
      isAbsent: file.status === 'deleted',
      objectId: file.newObject,
    };
  }
  return { path: oldPathOf(file), isAbsent: file.status === 'added', objectId: file.oldObject };
}

function oldPathOf(file: DiffFile): string {
  if ('oldPath' in file) {
    return file.oldPath;
  }
  return file.path;
}

function lines(mention: ChatMentionView): LineRange {
  const startLine = mention.startLine ?? 1;
  return { startLine, endLine: mention.endLine ?? startLine };
}

function refuse(message: string): Result<never, IpcError> {
  return err({ code: 'invalid-request', message });
}
