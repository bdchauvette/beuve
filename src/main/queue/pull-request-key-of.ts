/** Where a pull request lives, as far as a queue key needs it. */
export interface PullRequestPlace {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/**
 * A pull request's queue key and open ref (ADR 0113): `host/owner/repo#number`, which
 * `github:open-pr` takes as it is. Pure.
 */
export function pullRequestKeyOf(host: string, place: PullRequestPlace): string {
  return `${host}/${place.owner}/${place.repo}#${String(place.number)}`;
}
