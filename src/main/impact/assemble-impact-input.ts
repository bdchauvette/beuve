import type { ImpactSkipReason } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { BlobContent, BlobRequest } from '#internal/git/read-blobs.ts';
import type { ImpactSourceFile } from '#internal/impact/impact-input.ts';
import { rulesByLanguage } from '#internal/impact/rules-by-language.ts';
import { detectLanguage } from '#internal/syntax/detect-language.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { toChangedLines } from './to-changed-lines.ts';

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
  const requests = candidates.flatMap(({ base, head }) =>
    [base, head].flatMap((side) => (side.kind === 'blob' ? [side.request] : [])),
  );
  const blobs = await readBlobs(repository, requests);
  if (!blobs.ok) {
    return blobs;
  }
  const sources: ImpactSourceFile[] = [];
  for (const { file, base, head } of candidates) {
    const baseText = textOf(base, blobs.value);
    const headText = textOf(head, blobs.value);
    if (!baseText.ok || !headText.ok) {
      skipped.push({
        ...location(file),
        reason: baseText.ok ? (headText.ok ? 'no-source' : headText.error) : baseText.error,
      });
      continue;
    }
    sources.push({
      ...location(file),
      baseText: baseText.value,
      headText: headText.value,
      changedLines: toChangedLines(file),
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
    const language = candidate === undefined ? undefined : detectLanguage(candidate);
    return language !== undefined && rulesByLanguage[language] !== undefined;
  });
  if (!isSupported) {
    return 'unsupported-language';
  }
  const { base, head } = sides(file);
  return base.kind === 'absent' && head.kind === 'absent' ? 'no-source' : undefined;
}

function location(file: DiffFile): { path: string; previousPath: string | undefined } {
  return 'newPath' in file
    ? { path: file.newPath, previousPath: file.oldPath }
    : { path: file.path, previousPath: undefined };
}

function sides(file: DiffFile): { base: Side; head: Side } {
  const modes =
    file.status === 'added'
      ? { oldMode: undefined, newMode: file.mode }
      : file.status === 'deleted'
        ? { oldMode: file.mode, newMode: undefined }
        : { oldMode: file.oldMode, newMode: file.newMode };
  return {
    base: file.status === 'added' ? absent() : side(file.oldObject, modes.oldMode),
    head: file.status === 'deleted' ? absent() : side(file.newObject, modes.newMode),
  };
}

function absent(): Side {
  return { kind: 'absent' };
}

function side(objectId: string | undefined, mode: string | undefined): Side {
  return objectId === undefined || zeroIdPattern.test(objectId)
    ? absent()
    : { kind: 'blob', request: { objectId, mode } };
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
