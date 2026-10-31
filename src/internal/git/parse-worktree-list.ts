import type { CommitSha } from './object-id.ts';
import { parseCommitSha } from './parse-commit-sha.ts';

/** One entry of `git worktree list`. */
export interface Worktree {
  readonly path: string;
  /** `undefined` for a bare repository or an unborn branch. */
  readonly head: CommitSha | undefined;
  readonly checkout:
    | { readonly kind: 'branch'; readonly ref: string }
    | { readonly kind: 'detached' }
    | { readonly kind: 'bare' };
  readonly locked: { readonly reason: string } | undefined;
  /** Git would remove this entry on `worktree prune` (e.g. its directory is gone). */
  readonly prunable: { readonly reason: string } | undefined;
}

/**
 * Parses `git worktree list --porcelain -z`: NUL-terminated `key[ value]` attributes, with an
 * empty attribute ending each worktree. `undefined` if a record has no `worktree` line.
 */
export function parseWorktreeList(text: string): readonly Worktree[] | undefined {
  const worktrees: Worktree[] = [];
  let record: string[] = [];
  for (const field of text.split('\0')) {
    if (field !== '') {
      record.push(field);
      continue;
    }
    if (record.length === 0) {
      continue;
    }
    const worktree = parseRecord(record);
    if (worktree === undefined) {
      return undefined;
    }
    worktrees.push(worktree);
    record = [];
  }
  if (record.length > 0) {
    const worktree = parseRecord(record);
    if (worktree === undefined) {
      return undefined;
    }
    worktrees.push(worktree);
  }
  return worktrees;
}

const zeroIdPattern = /^0+$/u;

/** Why a worktree is locked or prunable, as git wrote it. */
interface WorktreeReason {
  readonly reason: string;
}

function checkoutOf(
  attributes: ReadonlyMap<string, string>,
  branch: string | undefined,
): Worktree['checkout'] {
  if (attributes.has('bare')) {
    return { kind: 'bare' };
  }
  if (branch === undefined) {
    return { kind: 'detached' };
  }
  return { kind: 'branch', ref: branch };
}

function parseRecord(fields: readonly string[]): Worktree | undefined {
  const attributes = new Map<string, string>();
  for (const field of fields) {
    const [key = '', ...value] = field.split(' ');
    attributes.set(key, value.join(' '));
  }
  const path = attributes.get('worktree');
  if (path === undefined || path === '') {
    return undefined;
  }
  const head = parseCommitSha(attributes.get('HEAD') ?? '');
  const branch = attributes.get('branch');
  const reason = (key: string): WorktreeReason | undefined => {
    const value = attributes.get(key);
    if (value === undefined) {
      return undefined;
    }
    return { reason: value };
  };
  let shownHead = head;
  if (head !== undefined && zeroIdPattern.test(head)) {
    shownHead = undefined;
  }
  return {
    path,
    head: shownHead,
    checkout: checkoutOf(attributes, branch),
    locked: reason('locked'),
    prunable: reason('prunable'),
  };
}
