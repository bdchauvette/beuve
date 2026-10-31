import path from 'node:path';

import type { EditorDefinition } from './editor-definitions.ts';

/** What detection may look at; tests pass a fake file system and environment. */
export interface EditorProbe {
  readonly platform: string;
  readonly env: { readonly PATH?: string | undefined; readonly HOME?: string | undefined };
  /** Whether `file` is an executable file (for CLIs) or exists (for app bundles). */
  readonly exists: (file: string) => boolean;
}

export type FoundEditor =
  { readonly kind: 'cli'; readonly command: string } | { readonly kind: 'url' };

/**
 * Looks for the editor's CLI on PATH, then in its well-known locations, and otherwise for its
 * macOS app bundle, which can be opened by URL. Windows isn't supported yet. `undefined` when
 * none is found.
 */
export function findEditor(
  definition: EditorDefinition,
  probe: EditorProbe,
): FoundEditor | undefined {
  if (probe.platform === 'win32') {
    return undefined;
  }
  const home = probe.env.HOME ?? '';
  const onPath = (probe.env.PATH ?? '')
    .split(path.delimiter)
    .filter((directory) => path.isAbsolute(directory))
    .flatMap((directory) => {
      return definition.executables.map((executable) => path.join(directory, executable));
    });
  const known = definition.knownPaths.flatMap((file) => expandHome(file, home));
  const candidates = [...onPath, ...known];
  for (const candidate of candidates) {
    if (probe.exists(candidate)) {
      return { kind: 'cli', command: candidate };
    }
  }
  if (probe.platform === 'darwin') {
    const bundles = definition.appBundles.flatMap((file) => expandHome(file, home));
    for (const bundle of bundles) {
      if (probe.exists(bundle)) {
        return { kind: 'url' };
      }
    }
  }
  return undefined;
}

function expandHome(file: string, home: string): string[] {
  if (!file.startsWith('~/')) {
    return [file];
  }
  if (home === '') {
    return [];
  }
  return [path.join(home, file.slice(2))];
}
