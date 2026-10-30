import { listTreeBlobs } from '#internal/git/list-tree-blobs.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { buildImportGraph } from '#internal/trace/build-import-graph.ts';
import { selectTests } from '#internal/trace/select-tests.ts';
import type { TestSelection } from '#internal/trace/select-tests.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

const scriptPattern = /\.[cm]?[jt]sx?$/u;
const maxScripts = 4000;
const maxScriptBytes = 256 * 1024;

/** Where the probe's file is and what the head holds around it. */
export interface TestSearch {
  readonly selections: readonly TestSelection[];
  /** The changed file's blob, when the head has it. */
  readonly objectId: string | undefined;
}

/**
 * Finds the test files likely to cover `changedPath` at `headSha` (ADR 0036): lists the head's
 * files, reads its scripts through git (never the checkout), builds the relative import graph and
 * asks the trace domain to rank tests by name and import distance.
 */
export async function findTestFiles(
  repository: GitRepository,
  headSha: CommitSha,
  changedPath: string,
): Promise<Result<TestSearch, GitError>> {
  const tree = await listTreeBlobs(repository, headSha);
  if (!tree.ok) {
    return tree;
  }
  const scripts = tree.value
    .filter(
      (blob) => scriptPattern.test(blob.path) && !blob.path.split('/').includes('node_modules'),
    )
    .slice(0, maxScripts);
  const blobs = await readBlobs(
    repository,
    scripts.map(({ objectId }) => ({ objectId })),
    { maxBlobBytes: maxScriptBytes },
  );
  if (!blobs.ok) {
    return blobs;
  }
  const sources = new Map<string, string>();
  for (const { path, objectId } of scripts) {
    const blob = blobs.value.get(objectId);
    if (blob?.kind === 'text') {
      sources.set(path, blob.text);
    }
  }
  const files = tree.value.map(({ path }) => path);
  const selections = selectTests({
    changedPath,
    files,
    imports: buildImportGraph(sources, files),
  });
  return ok({
    selections,
    objectId: tree.value.find(({ path }) => path === changedPath)?.objectId,
  });
}
