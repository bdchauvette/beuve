import type { Brand } from '#pkg/brand/brand.ts';

/** A full, lowercase hex commit object name (SHA-1 or SHA-256), as resolved by git. */
export type CommitSha = Brand<string, 'CommitSha'>;

/** A full, lowercase hex tree object name, such as one synthesized by `git merge-tree`. */
export type TreeSha = Brand<string, 'TreeSha'>;
