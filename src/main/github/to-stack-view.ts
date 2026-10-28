import type { PullRequestStackEntryView, PullRequestStackView } from '#contract/ipc-contract.ts';
import type { PullRequest } from '#internal/github/pull-request.ts';
import type { PullRequestStack } from '#internal/github/find-pull-request-stack.ts';

/**
 * Stack neighbours as chips the UI can open with `github:open-pr`: each `ref` is the canonical
 * `host/owner/repo#n`, so a GitHub Enterprise neighbour stays on its host.
 */
export function toStackView(host: string, stack: PullRequestStack): PullRequestStackView {
  const entry = (pull: PullRequest): PullRequestStackEntryView => {
    const repository = pull.base.repository;
    const fullName = repository === undefined ? '' : `${repository.owner}/${repository.name}`;
    return {
      ref: `${host}/${fullName}#${String(pull.number)}`,
      number: pull.number,
      title: pull.title,
      isDraft: pull.isDraft,
      htmlUrl: pull.htmlUrl,
    };
  };
  return {
    parents: stack.parents
      .filter((pull) => pull.base.repository !== undefined)
      .map((pull) => entry(pull)),
    children: stack.children
      .filter((pull) => pull.base.repository !== undefined)
      .map((pull) => entry(pull)),
  };
}
