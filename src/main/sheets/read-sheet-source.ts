import type { IpcError } from '#contract/ipc-contract.ts';
import { findTreeBlob } from '#internal/git/find-tree-blob.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import type { SheetCommit } from './resolve-sheet-commit.ts';

/** Sheets show files up to 4 MiB; anything larger is refused. */
const maxSheetBytes = 4 * 1024 * 1024;

/** The text of `path` at `commit`, or `not-found` / `unsupported` when it isn't a readable text file. */
export async function readSheetSource(
  context: SessionContext,
  commit: SheetCommit,
  path: string,
): Promise<Result<string, IpcError>> {
  const { repository } = commit.refreshed;
  const blob = await findTreeBlob(repository, commit.sha, path);
  if (!blob.ok) {
    return gitFailure(context.logger, blob.error);
  }
  if (blob.value === undefined) {
    return err({
      code: 'not-found',
      message: `${path} is not a file at ${commit.sha.slice(0, 7)}`,
    });
  }
  const read = await readBlobs(repository, [blob.value], { maxBlobBytes: maxSheetBytes });
  if (!read.ok) {
    return gitFailure(context.logger, read.error);
  }
  const content = read.value.get(blob.value.objectId);
  return content?.kind === 'text'
    ? ok(content.text)
    : err({ code: 'unsupported', message: `${path} is not a text file beuve can show` });
}
