import type { IpcError } from '#contract/ipc-contract.ts';
import { findTreeBlob } from '#internal/git/find-tree-blob.ts';
import { readBlobBytes } from '#internal/git/read-blob-bytes.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { imageTypeFrom } from './image-type-from.ts';
import type { SheetCommit } from './resolve-sheet-commit.ts';

/** Rich views show images up to 8 MiB (ADR 0123); a larger one is a placeholder. */
const maxImageBytes = 8 * 1024 * 1024;

/** An image to read: the commit it is pinned to, and its repository path there. */
export interface RepositoryImageRequest {
  readonly commit: SheetCommit;
  readonly path: string;
}

/**
 * The image at `path` in `commit` as a `data:` URI of the type its bytes say (ADR 0123):
 * `not-found` when no file is there, `unsupported` when it is not a PNG, JPEG, GIF, WebP or SVG
 * or is over 8 MiB.
 */
export async function readRepositoryImage(
  context: SessionContext,
  { commit, path }: RepositoryImageRequest,
  options: RequestOptions = {},
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
  const read = await readBlobBytes(repository, blob.value.objectId, {
    maxBytes: maxImageBytes,
    signal: options.signal,
  });
  if (!read.ok) {
    return gitFailure(context.logger, read.error);
  }
  if (read.value.kind === 'too-large') {
    return err({ code: 'unsupported', message: `${path} is larger than beuve shows (8 MiB)` });
  }
  if (read.value.kind !== 'bytes') {
    return err({
      code: 'not-found',
      message: `${path} is not a file at ${commit.sha.slice(0, 7)}`,
    });
  }
  const type = imageTypeFrom(read.value.bytes);
  if (type === undefined) {
    return err({ code: 'unsupported', message: `${path} is not an image beuve shows` });
  }
  return ok(`data:${type};base64,${new Uint8Array(read.value.bytes).toBase64()}`);
}
