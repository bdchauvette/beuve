import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { isWithinDirectory } from './is-within-directory.ts';
import type { LspError } from './lsp-error.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

/** A regular file inside a workspace root, after symlinks are resolved. */
export interface WorkspaceFile {
  readonly root: WorkspaceRoot;
  /** Real absolute path. */
  readonly absolutePath: string;
  /** Path relative to the root, with `/` separators. */
  readonly relativePath: string;
  readonly uri: string;
  readonly bytes: number;
}

/**
 * Resolves an untrusted path (relative to `root`, or absolute) to a regular file inside `root`.
 * Refuses `..` escapes and symlinks that lead outside the root.
 */
export async function resolveWorkspaceFile(
  root: WorkspaceRoot,
  filePath: string,
): Promise<Result<WorkspaceFile, LspError>> {
  if (filePath.length === 0 || filePath.includes('\0')) {
    return err({
      kind: 'invalid-path',
      path: filePath,
      reason: 'must be non-empty without NUL bytes',
    });
  }
  const lexical = path.resolve(root, filePath);
  if (!isWithinDirectory(root, lexical)) {
    return err({ kind: 'path-outside-root', path: filePath, root });
  }
  let real: string;
  let bytes: number;
  try {
    real = await realpath(lexical);
    const stats = await stat(real);
    if (!stats.isFile()) {
      return err({ kind: 'invalid-path', path: filePath, reason: 'not a regular file' });
    }
    bytes = stats.size;
  } catch {
    return err({ kind: 'invalid-path', path: filePath, reason: 'does not exist or is unreadable' });
  }
  if (!isWithinDirectory(root, real)) {
    return err({ kind: 'path-outside-root', path: filePath, root });
  }
  return ok({
    root,
    absolutePath: real,
    relativePath: path.relative(root, real).split(path.sep).join('/'),
    uri: pathToFileURL(real).href,
    bytes,
  });
}
