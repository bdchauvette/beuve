import { findTreeBlob } from '#internal/git/find-tree-blob.ts';
import type { TreeBlobEntry } from '#internal/git/find-tree-blob.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { UraHeadTexts } from '#internal/ura/compile-ura-artifact.ts';
import type { UraItem } from '#internal/ura/ura-item.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

/** A file a suggestion names, found in its item's head. */
interface FoundFile {
  readonly headSha: string;
  readonly path: string;
  readonly blob: TreeBlobEntry;
}

/**
 * The text of each file the items' suggestions name, at the head each item was written against
 * (ADR 0162), by head and path, read through the git typed operations. A file that is not in that
 * head's tree, or is binary, a submodule or larger than 1 MiB, is left out.
 */
export async function readSuggestionTexts(
  repository: GitRepository,
  items: readonly UraItem[],
): Promise<Result<UraHeadTexts, GitError>> {
  const wanted = new Map<string, Set<string>>();
  for (const item of items) {
    for (const { path } of item.suggestions) {
      wanted.getOrInsertComputed(item.headSha, () => new Set()).add(path);
    }
  }
  const found: FoundFile[] = [];
  for (const [headSha, paths] of wanted) {
    for (const path of paths) {
      const blob = await findTreeBlob(repository, headSha as UraItem['headSha'], path);
      if (!blob.ok) {
        return blob;
      }
      if (blob.value !== undefined) {
        found.push({ headSha, path, blob: blob.value });
      }
    }
  }
  if (found.length === 0) {
    return ok(new Map());
  }
  const read = await readBlobs(
    repository,
    found.map(({ blob }) => blob),
  );
  if (!read.ok) {
    return read;
  }
  const texts = new Map<string, Map<string, string>>();
  for (const { headSha, path, blob } of found) {
    const content = read.value.get(blob.objectId);
    if (content?.kind === 'text') {
      texts.getOrInsertComputed(headSha, () => new Map()).set(path, content.text);
    }
  }
  return ok(texts);
}
