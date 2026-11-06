import type { DiffFile } from '#internal/git/diff-model.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { BlobRequest } from '#internal/git/read-blobs.ts';
import type { GitError } from '#internal/git/git-error.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { headPathOf } from './head-path-of.ts';

const maxBlobBytes = 256 * 1024;
const maxShebangLength = 256;
const zeroIdPattern = /^0+$/u;
const extensionPattern = /.\.[^.]+$/u;

/**
 * The `#!` line of each file whose name has no extension, so the renderer can pick a grammar for
 * `bin/deploy` the way it does for `deploy.sh` (ADR 0120). Read from the head side, or the base
 * side of a deleted file, in one batch on the warm `cat-file` reader; binary, oversized and
 * submodule blobs have none. Keyed by the index of the file in `files`.
 */
export async function readShebangs(
  repository: GitRepository,
  files: readonly DiffFile[],
): Promise<Result<ReadonlyMap<number, string>, GitError>> {
  const wanted = new Map<number, BlobRequest>();
  for (const [index, file] of files.entries()) {
    const request = requestFor(file);
    if (request !== undefined) {
      wanted.set(index, request);
    }
  }
  if (wanted.size === 0) {
    return ok(new Map());
  }
  const blobs = await readBlobs(repository, wanted.values().toArray(), { maxBlobBytes });
  if (!blobs.ok) {
    return blobs;
  }
  const shebangs = new Map<number, string>();
  for (const [index, { objectId }] of wanted) {
    const blob = blobs.value.get(objectId);
    if (blob?.kind === 'text' && blob.text.startsWith('#!')) {
      shebangs.set(index, firstLineOf(blob.text));
    }
  }
  return ok(shebangs);
}

/** The blob to read for a file with no extension, or nothing for any other. */
function requestFor(file: DiffFile): BlobRequest | undefined {
  if (file.binary || file.submodule || !isExtensionless(headPathOf(file))) {
    return undefined;
  }
  switch (file.status) {
    case 'deleted': {
      return blobRequest({ objectId: file.oldObject, mode: file.mode });
    }
    case 'added': {
      return blobRequest({ objectId: file.newObject, mode: file.mode });
    }
    case 'modified':
    case 'renamed':
    case 'copied': {
      return blobRequest({ objectId: file.newObject, mode: file.newMode });
    }
  }
}

function isExtensionless(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return !extensionPattern.test(name);
}

/** One side of a file: its blob, if it has one, and its mode. */
interface BlobSide {
  readonly objectId: string | undefined;
  readonly mode: string | undefined;
}

function blobRequest({ objectId, mode }: BlobSide): BlobRequest | undefined {
  if (objectId === undefined || zeroIdPattern.test(objectId)) {
    return undefined;
  }
  return { objectId, mode };
}

function firstLineOf(text: string): string {
  const end = text.indexOf('\n');
  if (end === -1) {
    return text.slice(0, maxShebangLength).trimEnd();
  }
  return text.slice(0, Math.min(end, maxShebangLength)).trimEnd();
}
