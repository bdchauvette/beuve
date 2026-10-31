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

function parseRecord(fields: readonly string[]): Worktree | undefined {
  const attributes = new Map<string, string>();
  for (const field of fields) {
    const space = field.indexOf(' ');
    attributes.set(
      space === -1 ? field : field.slice(0, space),
      space === -1 ? '' : field.slice(space + 1),
    );
  }
  const path = attributes.get('worktree');
  if (path === undefined || path === '') {
    return undefined;
  }
  const head = parseCommitSha(attributes.get('HEAD') ?? '');
  const branch = attributes.get('branch');
  const reason = (key: string): { readonly reason: string } | undefined => {
    const value = attributes.get(key);
    if (value === undefined) {
      return undefined;
    }
    return { reason: value };
  };
  return {
    path,
    head: head === undefined || zeroIdPattern.test(head) ? undefined : head,
    checkout: attributes.has('bare')
      ? { kind: 'bare' }
      : branch === undefined
        ? { kind: 'detached' }
        : { kind: 'branch', ref: branch },
    locked: reason('locked'),
    prunable: reason('prunable'),
  };
}
