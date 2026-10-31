import path from 'node:path';

import type { WorkspaceRoot } from './resolve-workspace-root.ts';

/** Whether absolute `candidate` is `root` or lies beneath it, judged lexically. */
export function isWithinDirectory(root: WorkspaceRoot, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
