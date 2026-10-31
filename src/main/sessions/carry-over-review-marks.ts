import type { IpcError } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { fileDiffIdFrom } from '#internal/git/file-diff-id-from.ts';
import { carryOverFileMarks } from '#internal/session/carry-over-file-marks.ts';
import type { CarriedMarks } from '#internal/session/carry-over-file-marks.ts';
import { listFileMarks } from '#internal/session/list-file-marks.ts';
import type { SessionId } from '#internal/session/session.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { headPathOf } from './head-path-of.ts';
import { oldPathOf } from './old-path-of.ts';
import type { SessionContext } from './session-context.ts';
import { sessionFailure } from './session-failure.ts';

/** The files a review shows, and the plain diff's files whose identities key the marks. */
export interface MarkedFiles {
  readonly shown: readonly DiffFile[];
  readonly identified: readonly DiffFile[];
}

/**
 * The reviewed state of the files `shown` (ADR 0064). Marks are keyed by the diff identity of the
 * plain diff, so `identified` is the plain diff's files (the same as `shown` unless a display
 * variant such as ignore-whitespace was asked for); a shown file the plain diff lacks uses its own.
 */
export function carryOverReviewMarks(
  context: SessionContext,
  sessionId: SessionId,
  { shown, identified }: MarkedFiles,
): Result<CarriedMarks, IpcError> {
  const marks = listFileMarks(context.db, sessionId);
  if (!marks.ok) {
    return sessionFailure(context.logger, marks.error);
  }
  const idByPath = new Map(
    identified.map((file) => {
      return [headPathOf(file), fileDiffIdFrom(file)];
    }),
  );
  return ok(
    carryOverFileMarks(
      marks.value,
      shown.map((file) => {
        return {
          path: headPathOf(file),
          oldPath: oldPathOf(file),
          diffId: idByPath.get(headPathOf(file)) ?? fileDiffIdFrom(file),
        };
      }),
    ),
  );
}
