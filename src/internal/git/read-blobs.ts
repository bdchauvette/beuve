import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import { isObjectId } from './is-object-id.ts';
import type { ObjectContent } from './object-spec.ts';
import type { GitRepository } from './open-repository.ts';

/** A blob to read, by full object name. `mode` is the file mode from the diff, when known. */
export interface BlobRequest {
  readonly objectId: string;
  readonly mode?: string | undefined;
}

/**
 * What a blob holds, as far as a reader of source text cares. Binary means a NUL byte in the
 * first 8000 bytes (git's own heuristic). A gitlink (mode `160000`) names a commit in another
 * repository, so it is never read.
 */
export type BlobContent =
  | { readonly kind: 'text'; readonly text: string; readonly size: number }
  | { readonly kind: 'binary'; readonly size: number }
  | { readonly kind: 'too-large'; readonly size: number; readonly limit: number }
  | { readonly kind: 'submodule' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not-a-blob'; readonly type: string };

export interface ReadBlobsOptions {
  /** Blobs larger than this many bytes are reported as `too-large` without being read. Defaults to 1 MiB. */
  readonly maxBlobBytes?: number;
}

const defaultMaxBlobBytes = 1024 * 1024;
const gitlinkMode = '160000';
const binaryProbeBytes = 8000;

/**
 * Reads many blobs on the repository's warm `cat-file --batch-command` (ADR 0087), all
 * pipelined: each is sized with `info` first, and only blobs within the limit are read, so a
 * large one never crosses the pipe. Results are keyed by object id; duplicates are read once.
 */
export async function readBlobs(
  repository: GitRepository,
  requests: readonly BlobRequest[],
  options: ReadBlobsOptions = {},
): Promise<Result<ReadonlyMap<string, BlobContent>, GitError>> {
  const limit = options.maxBlobBytes ?? defaultMaxBlobBytes;
  const contents = new Map<string, BlobContent>();
  const pending = new Set<string>();
  for (const { objectId, mode } of requests) {
    if (!isObjectId(objectId)) {
      return err({ kind: 'invalid-argument', argument: objectId, reason: 'not a full object id' });
    }
    if (mode === gitlinkMode) {
      contents.set(objectId, { kind: 'submodule' });
    } else if (!contents.has(objectId)) {
      pending.add(objectId);
    }
  }
  const objects = repository[gitRunner].objects;
  const read = await Promise.all(
    Array.from(pending, async (oid) => {
      return objects.read({ kind: 'object', oid }, { maxBytes: limit });
    }),
  );
  for (const [index, objectId] of [...pending].entries()) {
    const result = read[index];
    if (result === undefined) {
      continue;
    }
    if (!result.ok) {
      return result;
    }
    contents.set(objectId, blobContentFrom(result.value));
  }
  return ok(contents);
}

function blobContentFrom(object: ObjectContent): BlobContent {
  switch (object.kind) {
    case 'missing':
    case 'ambiguous': {
      return { kind: 'missing' };
    }
    case 'too-large': {
      if (object.type === 'blob') {
        return { kind: 'too-large', size: object.size, limit: object.limit };
      }
      return { kind: 'not-a-blob', type: object.type };
    }
    case 'content': {
      if (object.type === 'blob') {
        return contentFrom(object.bytes);
      }
      return { kind: 'not-a-blob', type: object.type };
    }
  }
}

function contentFrom(bytes: Buffer): BlobContent {
  const probe = bytes.subarray(0, binaryProbeBytes);
  if (probe.includes(0)) {
    return { kind: 'binary', size: bytes.length };
  }
  return { kind: 'text', text: new TextDecoder('utf-8').decode(bytes), size: bytes.length };
}
