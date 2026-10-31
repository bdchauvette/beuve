import type { ImpactSkipReason } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { BlobContent, BlobRequest } from '#internal/git/read-blobs.ts';
import type { ImpactSourceFile } from '#internal/impact/impact-input.ts';
import { rulesByLanguage } from '#internal/impact/rules-by-language.ts';
import { detectLanguage } from '#internal/syntax/detect-language.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { changedLinesFrom } from './changed-lines-from.ts';

/** A diff file left out before parsing, with the reason the impact view reports. */
export interface PreSkippedFile {
  readonly path: string;
  readonly previousPath: string | undefined;
  readonly reason: ImpactSkipReason;
}

export interface ImpactInput {
  readonly sources: readonly ImpactSourceFile[];
  readonly skipped: readonly PreSkippedFile[];
}

/** One side of a diff file: absent, or a blob with the mode the diff gave it. */
type Side = { readonly kind: 'absent' } | { readonly kind: 'blob'; readonly request: BlobRequest };

const zeroIdPattern = /^0+$/u;

/**
 * Turns review diff files into ImpactGate input (ADR 0015): base and head text read by blob id
 * from the git domain, plus the changed lines from the hunks. Files ImpactGate has no rules for,
 * binary files and submodules are skipped here without reading anything.
 */
export async function assembleImpactInput(
  repository: GitRepository,
  files: readonly DiffFile[],
): Promise<Result<ImpactInput, GitError>> {
  const candidates: { file: DiffFile; base: Side; head: Side }[] = [];
  const skipped: PreSkippedFile[] = [];
  for (const file of files) {
    const reason = preSkipReason(file);
    if (reason !== undefined) {
      skipped.push({ ...location(file), reason });
      continue;
    }
    candidates.push({ file, ...sides(file) });
  }
  const requests = candidates.flatMap(({ base, head }) => {
    return [base, head].flatMap((side) => {
      if (side.kind === 'blob') {
        return [side.request];
      }
      return [];
    });
  });
  const blobs = await readBlobs(repository, requests);
  if (!blobs.ok) {
    return blobs;
  }
  const sources: ImpactSourceFile[] = [];
  for (const { file, base, head } of candidates) {
    const baseText = textOf(base, blobs.value);
    const headText = textOf(head, blobs.value);
    if (!baseText.ok || !headText.ok) {
      let reason: ImpactSkipReason = 'no-source';
      if (!baseText.ok) {
        reason = baseText.error;
      } else if (!headText.ok) {
        reason = headText.error;
      }
      skipped.push({ ...location(file), reason });
      continue;
    }
    sources.push({
      ...location(file),
      baseText: baseText.value,
      headText: headText.value,
      changedLines: changedLinesFrom(file),
    });
  }
  return ok({ sources, skipped });
}

function preSkipReason(file: DiffFile): ImpactSkipReason | undefined {
  if (file.submodule) {
    return 'submodule';
  }
  if (file.binary) {
    return 'binary';
  }
  const { path, previousPath } = location(file);
  const isSupported = [path, previousPath].some((candidate) => {
    if (candidate === undefined) {
      return false;
    }
    const language = detectLanguage(candidate);
    return language !== undefined && rulesByLanguage[language] !== undefined;
  });
  if (!isSupported) {
    return 'unsupported-language';
  }
  const { base, head } = sides(file);
  if (base.kind === 'absent' && head.kind === 'absent') {
    return 'no-source';
  }
  return undefined;
}

/** Where a file is at the head, and where it was before a rename. */
interface FileLocation {
  readonly path: string;
  readonly previousPath: string | undefined;
}

/** A file's base and head blobs. */
interface FileSides {
  readonly base: Side;
  readonly head: Side;
}

/** A side's object id and mode, as the diff reports them. */
interface SideObject {
  readonly objectId: string | undefined;
  readonly mode: string | undefined;
}

function location(file: DiffFile): FileLocation {
  if ('newPath' in file) {
    return { path: file.newPath, previousPath: file.oldPath };
  }
  return { path: file.path, previousPath: undefined };
}

function sides(file: DiffFile): FileSides {
  if (file.status === 'added') {
    return { base: absent(), head: side({ objectId: file.newObject, mode: file.mode }) };
  }
  if (file.status === 'deleted') {
    return { base: side({ objectId: file.oldObject, mode: file.mode }), head: absent() };
  }
  return {
    base: side({ objectId: file.oldObject, mode: file.oldMode }),
    head: side({ objectId: file.newObject, mode: file.newMode }),
  };
}

function absent(): Side {
  return { kind: 'absent' };
}

function side({ objectId, mode }: SideObject): Side {
  if (objectId === undefined || zeroIdPattern.test(objectId)) {
    return absent();
  }
  return { kind: 'blob', request: { objectId, mode } };
}

function textOf(
  side: Side,
  blobs: ReadonlyMap<string, BlobContent>,
): Result<string | undefined, ImpactSkipReason> {
  if (side.kind === 'absent') {
    return ok(undefined);
  }
  const content = blobs.get(side.request.objectId);
  switch (content?.kind) {
    case 'text': {
      return ok(content.text);
    }
    case 'binary':
    case 'too-large':
    case 'submodule': {
      return err(content.kind);
    }
    case 'missing':
    case 'not-a-blob':
    case undefined: {
      return err('no-source');
    }
  }
}
