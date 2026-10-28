import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Brand } from '#pkg/brand/brand.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { LspError } from './lsp-error.ts';

/** The real (symlink-free) absolute path of an existing directory a language server may serve. */
export type WorkspaceRoot = Brand<string, 'WorkspaceRoot'>;

/** Validates an untrusted root path and resolves it to its real path. */
export async function resolveWorkspaceRoot(root: string): Promise<Result<WorkspaceRoot, LspError>> {
  if (root.length === 0 || root.includes('\0')) {
    return err({
      kind: 'invalid-root',
      root,
      reason: 'must be a non-empty path without NUL bytes',
    });
  }
  if (!path.isAbsolute(root)) {
    return err({ kind: 'invalid-root', root, reason: 'must be absolute' });
  }
  try {
    const real = await realpath(root);
    const stats = await stat(real);
    return stats.isDirectory()
      ? ok(real as WorkspaceRoot)
      : err({ kind: 'invalid-root', root, reason: 'not a directory' });
  } catch {
    return err({ kind: 'invalid-root', root, reason: 'does not exist or is unreadable' });
  }
}
