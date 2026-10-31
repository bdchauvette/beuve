import type { ImpactSourceFile } from './impact-input.ts';

/** Where a file is: its path, and its base path when it was renamed. */
export interface FileLocation {
  readonly path: string;
  readonly previousPath?: string;
}

/** `file`'s location, without a `previousPath` key when it wasn't renamed. */
export function locationOf(file: Pick<ImpactSourceFile, 'path' | 'previousPath'>): FileLocation {
  if (file.previousPath === undefined) {
    return { path: file.path };
  }
  return { path: file.path, previousPath: file.previousPath };
}
