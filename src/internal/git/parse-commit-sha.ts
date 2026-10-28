import { isObjectId } from './is-object-id.ts';
import type { CommitSha } from './object-id.ts';

/**
 * Brands `text` as a {@link CommitSha} if it is a full lowercase hex object name. This checks the
 * format only; use `resolveRevision` to confirm a commit exists.
 */
export function parseCommitSha(text: string): CommitSha | undefined {
  return isObjectId(text) ? (text as CommitSha) : undefined;
}
