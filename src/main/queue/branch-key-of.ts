/** Where a branch lives, as far as a queue key needs it. */
export interface BranchPlace {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

/**
 * A branch's queue key and open ref (ADR 0113): `host/owner/repo:branch`, which
 * `github:open-branch` takes as it is. Pure.
 */
export function branchKeyOf(host: string, place: BranchPlace): string {
  return `${host}/${place.owner}/${place.repo}:${place.branch}`;
}
