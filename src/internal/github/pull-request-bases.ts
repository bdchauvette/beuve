import type { RepositoryName } from './get-repository.ts';

/** A followed branch's repository and, for a fork, the repositories it was forked from. */
export interface BranchLineage {
  readonly repository: RepositoryName;
  readonly parent: RepositoryName | undefined;
  readonly source: RepositoryName | undefined;
}

/**
 * The repositories asked for a followed branch's open pull request, in the order the first found
 * wins (ADR 0112 and its fork amendment): the branch's own repository, then the fork's parent,
 * then the root of its fork network when that is another repository. Sibling forks are never
 * asked. Names compare case-insensitively, as GitHub's do. Pure.
 */
export function pullRequestBases({
  repository,
  parent,
  source,
}: BranchLineage): readonly RepositoryName[] {
  const bases = new Map<string, RepositoryName>();
  for (const candidate of [repository, parent, source]) {
    if (candidate !== undefined) {
      bases.getOrInsertComputed(`${candidate.owner}/${candidate.repo}`.toLowerCase(), () => {
        return { owner: candidate.owner, repo: candidate.repo };
      });
    }
  }
  return bases.values().toArray();
}
