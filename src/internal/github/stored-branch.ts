import type { BranchRef } from './branch-ref.ts';

/**
 * What beuve keeps of a followed branch between runs (ADR 0112). `state` is `gone` once GitHub
 * answered 404 for it; `headSha` is then the last head beuve saw. `pullNumber` is the open pull
 * request found for the branch while another session already reviews it (otherwise the session
 * was promoted). `fetchedAt` is when beuve last saw it change.
 */
export interface StoredBranch {
  readonly ref: BranchRef;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly headSha: string;
  readonly state: 'present' | 'gone';
  readonly pullNumber: number | undefined;
  readonly fetchedAt: string;
}

/** A stored row that doesn't describe a branch; reported rather than cast. */
export interface CorruptBranchRow {
  readonly kind: 'corrupt-row';
  readonly table: 'github_branches';
  readonly reason: string;
}
