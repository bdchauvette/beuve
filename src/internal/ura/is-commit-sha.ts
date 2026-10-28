import type { CommitSha } from './ura-item.ts';

const commitSha = /^(?:[\da-f]{40}|[\da-f]{64})$/u;

/** True for a full, lowercase commit id (SHA-1 or SHA-256). */
export function isCommitSha(value: unknown): value is CommitSha {
  return typeof value === 'string' && commitSha.test(value);
}
