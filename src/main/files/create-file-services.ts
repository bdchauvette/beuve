import type {
  FileAttributesView,
  FilePairView,
  GetFileAttributesRequest,
  GetFilePairRequest,
  GetTreeRequest,
  IpcResult,
  RepositoryTreeView,
} from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { listTreePaths } from '#internal/git/list-tree-paths.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import { readDiffAttributes } from '#internal/git/read-diff-attributes.ts';
import type { DiffAttributes } from '#internal/git/parse-check-attr.ts';
import type { BlobContent } from '#internal/git/read-blobs.ts';
import { LruCache } from '#x/collections/lru-cache.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import type { RequestOptions } from '../request-options.ts';
import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import { loadSession } from '../sessions/load-session.ts';
import { refreshSession } from '../sessions/refresh-session.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { findPackageRoots } from './find-package-roots.ts';

/**
 * Whole files and the repository tree, for the radar tree and hunk expansion (ADR 0018), and the
 * review files' `.gitattributes` (ADR 0052).
 */
export interface FileServices {
  readonly getTree: (
    request: GetTreeRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<RepositoryTreeView>>;
  readonly getFilePair: (request: GetFilePairRequest) => Promise<IpcResult<FilePairView>>;
  readonly getFileAttributes: (
    request: GetFileAttributesRequest,
    options?: RequestOptions,
  ) => Promise<IpcResult<FileAttributesView>>;
}

type AttributeLists = Pick<FileAttributesView, 'generated' | 'notGenerated' | 'noDiff'>;

export interface FileServicesOptions {
  readonly context: SessionContext;
  /** Trees kept, one per (repository, head). Defaults to 8. */
  readonly cacheSize?: number;
}

const zeroIdPattern = /^0+$/u;

/**
 * `session:get-tree` lists the session head's tree (refreshing the head first) and its package
 * roots, cached per (repository, head). `session:get-file-pair` reads both sides of one file of
 * the review the session shows now, by the blob ids in its diff, so only reviewed files are read.
 * `session:get-file-attributes` reads `linguist-generated` and `diff` for the files of that
 * review from `.gitattributes` at the head (one `git check-attr`), cached per head and paths; a
 * git without `check-attr --source` answers empty lists.
 */
export function createFileServices(options: FileServicesOptions): FileServices {
  const { context } = options;
  const trees = new LruCache<string, Pick<RepositoryTreeView, 'paths' | 'packageRoots'>>(
    options.cacheSize ?? 8,
  );
  const attributes = new LruCache<string, AttributeLists>(options.cacheSize ?? 8);
  return {
    getTree: async ({ sessionId }, call = {}): Promise<IpcResult<RepositoryTreeView>> => {
      const loaded = loadSession(context, sessionId);
      if (!loaded.ok) {
        return loaded;
      }
      const refreshed = await refreshSession(context, loaded.value, { signal: call.signal });
      if (!refreshed.ok) {
        return refreshed;
      }
      const { repository, session } = refreshed.value;
      const key = `${repository.root}\0${session.headSha}`;
      const cached = trees.get(key);
      if (cached !== undefined) {
        return ok({ sessionId, headSha: session.headSha, ...cached });
      }
      const paths = await listTreePaths(repository, session.headSha);
      if (!paths.ok) {
        return gitFailure(context.logger, paths.error);
      }
      const listing = { paths: paths.value, packageRoots: findPackageRoots(paths.value) };
      trees.set(key, listing);
      return ok({ sessionId, headSha: session.headSha, ...listing });
    },
    getFilePair: async ({ sessionId, path }): Promise<IpcResult<FilePairView>> => {
      const diff = await loadReviewDiff(context, sessionId);
      if (!diff.ok) {
        return diff;
      }
      const file = diff.value.files.find((candidate) => headPath(candidate) === path);
      if (file === undefined) {
        return err({ code: 'not-found', message: 'that file is not in the review' });
      }
      const sides = [blobId(file, 'old'), blobId(file, 'new')];
      const blobs = await readBlobs(
        diff.value.refreshed.repository,
        sides
          .filter((objectId) => objectId !== undefined)
          .map((objectId) => {
            return { objectId };
          }),
      );
      if (!blobs.ok) {
        return gitFailure(context.logger, blobs.error);
      }
      const [oldContents, newContents] = sides.map((objectId) => textOf(objectId, blobs.value));
      if (oldContents === undefined || newContents === undefined) {
        return err({ code: 'unsupported', message: 'a side of this file is not readable text' });
      }
      return ok({
        path,
        ...('oldPath' in file && { oldPath: file.oldPath }),
        ...(oldContents.value !== undefined && { oldContents: oldContents.value }),
        ...(newContents.value !== undefined && { newContents: newContents.value }),
      });
    },
    getFileAttributes: async ({ sessionId }, call = {}): Promise<IpcResult<FileAttributesView>> => {
      const diff = await loadReviewDiff(context, sessionId, { signal: call.signal });
      if (!diff.ok) {
        return diff;
      }
      const { repository, session } = diff.value.refreshed;
      const paths = diff.value.files.map((file) => headPath(file));
      const key = [repository.root, session.headSha, ...paths].join('\0');
      const cached = attributes.get(key);
      if (cached !== undefined) {
        return ok({ sessionId, headSha: session.headSha, ...cached });
      }
      const read = await readDiffAttributes(repository, session.headSha, paths);
      if (!read.ok && read.error.kind !== 'unsupported-git-version') {
        return gitFailure(context.logger, read.error);
      }
      const lists = attributeListsFrom(read.ok ? read.value : new Map());
      attributes.set(key, lists);
      return ok({ sessionId, headSha: session.headSha, ...lists });
    },
  };
}

function attributeListsFrom(read: ReadonlyMap<string, DiffAttributes>): AttributeLists {
  const entries = [...read];
  const where = (isListed: (value: DiffAttributes) => boolean): string[] => {
    return entries.filter(([, value]) => isListed(value)).map(([path]) => path);
  };
  return {
    generated: where((value) => value.generated === true),
    notGenerated: where((value) => value.generated === false),
    noDiff: where((value) => value.diff === false),
  };
}

function headPath(file: DiffFile): string {
  return 'newPath' in file ? file.newPath : file.path;
}

function blobId(file: DiffFile, side: 'old' | 'new'): string | undefined {
  const isAbsent = side === 'old' ? file.status === 'added' : file.status === 'deleted';
  const objectId = side === 'old' ? file.oldObject : file.newObject;
  return isAbsent || objectId === undefined || zeroIdPattern.test(objectId) ? undefined : objectId;
}

/** `{ value: undefined }` for an absent side, `undefined` when the side is not readable text. */
function textOf(
  objectId: string | undefined,
  blobs: ReadonlyMap<string, BlobContent>,
): { readonly value: string | undefined } | undefined {
  if (objectId === undefined) {
    return { value: undefined };
  }
  const content = blobs.get(objectId);
  return content?.kind === 'text' ? { value: content.text } : undefined;
}
