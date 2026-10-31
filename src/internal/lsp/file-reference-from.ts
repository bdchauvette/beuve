import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isWithinDirectory } from './is-within-directory.ts';
import type { FileReference } from './lsp-model.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

/** Turns a server's URI into a root-relative path when it points inside `root`. */
export function fileReferenceFrom(root: WorkspaceRoot, uri: string): FileReference {
  const filePath = pathFromFileUri(uri);
  if (filePath === undefined || filePath === root || !isWithinDirectory(root, filePath)) {
    return { kind: 'external', uri };
  }
  return { kind: 'workspace', path: path.relative(root, filePath).split(path.sep).join('/') };
}

function pathFromFileUri(uri: string): string | undefined {
  if (!uri.startsWith('file:')) {
    return undefined;
  }
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}
