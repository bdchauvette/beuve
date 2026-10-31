import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { isObjectId } from './is-object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A blob's raw bytes, or why there are none. */
export type BlobBytes =
  | { readonly kind: 'bytes'; readonly bytes: Buffer }
  | { readonly kind: 'too-large'; readonly size: number; readonly limit: number }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not-a-blob'; readonly type: string };

export interface ReadBlobOptions {
  /** A larger blob answers `too-large` without being read. */
  readonly maxBytes: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * One blob's raw content (no filters, no textconv) on the repository's warm
 * `cat-file --batch-command` (ADR 0087), sized first so a blob over `maxBytes` is never read.
 */
export async function readBlobBytes(
  repository: GitRepository,
  objectId: string,
  options: ReadBlobOptions,
): Promise<Result<BlobBytes, GitError>> {
  if (!isObjectId(objectId)) {
    return err({ kind: 'invalid-argument', argument: objectId, reason: 'not a full object id' });
  }
  const read = await repository[gitRunner].objects.read(
    { kind: 'object', oid: objectId },
    { maxBytes: options.maxBytes, signal: options.signal },
  );
  if (!read.ok) {
    return read;
  }
  const object = read.value;
  switch (object.kind) {
    case 'missing':
    case 'ambiguous': {
      return ok({ kind: 'missing' });
    }
    case 'too-large': {
      if (object.type !== 'blob') {
        return ok({ kind: 'not-a-blob', type: object.type });
      }
      return ok({ kind: 'too-large', size: object.size, limit: object.limit });
    }
    case 'content': {
      if (object.type !== 'blob') {
        return ok({ kind: 'not-a-blob', type: object.type });
      }
      return ok({ kind: 'bytes', bytes: object.bytes });
    }
  }
}
