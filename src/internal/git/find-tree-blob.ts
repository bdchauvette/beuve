import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { ObjectSpec } from './object-spec.ts';
import type { GitRepository } from './open-repository.ts';
import type { TreeBlob } from './list-tree-blobs.ts';

/** A blob in a tree, with its file mode. */
export interface TreeBlobEntry extends TreeBlob {
  readonly mode: string;
}
import { parseLsTreeEntry } from './parse-ls-tree-entry.ts';
import { parseTreeObject } from './parse-tree-object.ts';
import { parseTreePath } from './parse-tree-path.ts';

const treeMode = '040000';
const gitlinkMode = '160000';
/** Far more than any directory listing; a larger tree is looked up with `ls-tree` instead. */
const maxTreeBytes = 64 * 1024 * 1024;

/**
 * The blob tracked at exactly `path` (repository-relative, `/` separators) in `commit`'s tree, or
 * `undefined` when the path is absent there or is not a file (a directory, a submodule). The
 * parent directory's tree object is read on the repository's warm `cat-file --batch-command`
 * (ADR 0087) and the entry, with its mode, found by name. A path the line protocol can't carry
 * (a newline, a tab, other control characters; see `parseTreePath`) is looked up with
 * `ls-tree -z` instead, whose default format never quotes (`parseLsTreeEntry`), so any path git
 * can store is found, quotes, backslashes and control characters included.
 */
export async function findTreeBlob(
  repository: GitRepository,
  commit: CommitSha,
  path: string,
): Promise<Result<TreeBlobEntry | undefined, GitError>> {
  const treePath = parseTreePath(path);
  if (treePath === undefined) {
    return findWithLsTree(repository, commit, path);
  }
  return findInParentTree(repository, commit, treePath);
}

async function findInParentTree(
  repository: GitRepository,
  commit: CommitSha,
  file: string,
): Promise<Result<TreeBlobEntry | undefined, GitError>> {
  const directory = path.posix.dirname(file);
  const name = path.posix.basename(file);
  const parent = parseTreePath(directory);
  let spec: ObjectSpec = { kind: 'ref', ref: commit, peel: 'tree' };
  if (parent !== undefined) {
    spec = { kind: 'path', commit, path: parent };
  }
  const tree = await repository[gitRunner].objects.read(spec, { maxBytes: maxTreeBytes });
  if (!tree.ok) {
    return tree;
  }
  if (tree.value.kind === 'too-large') {
    return findWithLsTree(repository, commit, file);
  }
  if (tree.value.kind !== 'content' || tree.value.type !== 'tree') {
    return ok(undefined);
  }
  const entries = parseTreeObject(tree.value.bytes, commit.length / 2);
  if (entries === undefined) {
    return err({
      kind: 'unexpected-output',
      args: ['cat-file', '--batch-command'],
      message: `not a tree object: ${tree.value.oid}`,
    });
  }
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined || entry.mode === treeMode || entry.mode === gitlinkMode) {
    return ok(undefined);
  }
  return ok({ path: file, mode: entry.mode, objectId: entry.objectId });
}

async function findWithLsTree(
  repository: GitRepository,
  commit: CommitSha,
  path: string,
): Promise<Result<TreeBlobEntry | undefined, GitError>> {
  const output = await repository[gitRunner].exec(
    ['ls-tree', '-z', '--end-of-options', commit, '--', path],
    { policy: { kind: 'read' } },
  );
  if (!output.ok) {
    return output;
  }
  for (const line of output.value.toString('utf8').split('\0')) {
    const entry = parseLsTreeEntry(line);
    if (entry?.type === 'blob' && entry.path === path) {
      return ok({ path, mode: entry.mode, objectId: entry.objectId });
    }
  }
  return ok(undefined);
}
