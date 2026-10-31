import { listTreeBlobs } from '#internal/git/list-tree-blobs.ts';
import type { CommitSha } from '#internal/git/object-id.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { GitError } from '#internal/git/git-error.ts';
import { createModuleResolver } from '#internal/syntax/create-module-resolver.ts';
import type { ModuleResolver } from '#internal/syntax/create-module-resolver.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

const configPattern = /(?:^|\/)(?:package|tsconfig)\.json$/u;

/**
 * A module resolver over the tree at `headSha`: every tracked path, with the `package.json` and
 * `tsconfig.json` files read from git (never the working tree, so the head need not be checked out).
 */
export async function createHeadModuleResolver(
  repository: GitRepository,
  headSha: CommitSha,
): Promise<Result<ModuleResolver, GitError>> {
  const tree = await listTreeBlobs(repository, headSha);
  if (!tree.ok) {
    return tree;
  }
  const configBlobs = tree.value.filter((blob) => {
    return configPattern.test(blob.path) && !blob.path.includes('node_modules/');
  });
  const contents = await readBlobs(
    repository,
    configBlobs.map(({ objectId }) => {
      return { objectId };
    }),
  );
  if (!contents.ok) {
    return contents;
  }
  const configs = new Map<string, string>();
  for (const blob of configBlobs) {
    const content = contents.value.get(blob.objectId);
    if (content?.kind === 'text') {
      configs.set(blob.path, content.text);
    }
  }
  const paths = new Set(tree.value.map(({ path }) => path));
  return ok(createModuleResolver({ paths, configs }));
}
