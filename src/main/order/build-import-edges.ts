import type { DiffFile } from '#internal/git/diff-model.ts';
import type { GitRepository } from '#internal/git/open-repository.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import type { GitError } from '#internal/git/git-error.ts';
import type { DependencyEdge } from '#internal/session/order-review-files.ts';
import type { ParseSyntax } from '#internal/syntax/create-syntax-parser.ts';
import type { ModuleResolver } from '#internal/syntax/create-module-resolver.ts';
import { extractModuleReferences } from '#internal/syntax/extract-module-references.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { headPathOf } from '../sessions/head-path-of.ts';

import { isImportSource } from './is-import-source.ts';

/** A review's files, and the changed head paths whose edges count. */
export interface ChangedFiles {
  readonly files: readonly DiffFile[];
  readonly paths: ReadonlySet<string>;
}

/** How to read a file's imports and resolve them in the head tree. */
export interface ImportReader {
  readonly parse: ParseSyntax;
  readonly resolve: ModuleResolver;
}

/**
 * `dependent imports dependency` between the changed files in `paths` (ADR 0065): each changed
 * TypeScript or JavaScript file's head blob is parsed for imports, exports-from, `import()` and
 * `require()`, and each specifier is resolved against the head tree. Imports of unchanged files,
 * packages and unreadable files add no edge. Type-only imports count: the types are part of what
 * the reader must know first.
 */
export async function buildImportEdges(
  repository: GitRepository,
  { parse, resolve }: ImportReader,
  { files, paths }: ChangedFiles,
): Promise<Result<readonly DependencyEdge[], GitError>> {
  const sources = files.filter((file) => {
    return (
      file.status !== 'deleted' && paths.has(headPathOf(file)) && isImportSource(headPathOf(file))
    );
  });
  const requests = sources
    .filter((file) => file.newObject !== undefined)
    .map((file) => {
      return { objectId: file.newObject ?? '', mode: newModeOf(file) };
    });
  const blobs = await readBlobs(repository, requests);
  if (!blobs.ok) {
    return blobs;
  }
  const edges: DependencyEdge[] = [];
  for (const file of sources) {
    if (file.newObject === undefined) {
      continue;
    }
    const content = blobs.value.get(file.newObject);
    if (content?.kind !== 'text') {
      continue;
    }
    const dependent = headPathOf(file);
    const parsed = await parse({ path: dependent, text: content.text }, (root) => {
      return extractModuleReferences(root).map((reference) => reference.specifier);
    });
    if (!parsed.ok) {
      continue;
    }
    const specifiers = new Set(parsed.value);
    for (const specifier of specifiers) {
      const dependency = resolve({ specifier, fromPath: dependent });
      if (dependency !== undefined && dependency !== dependent && paths.has(dependency)) {
        edges.push({ dependent, dependency });
      }
    }
  }
  return ok(edges);
}

function newModeOf(file: DiffFile): string | undefined {
  if (file.status === 'added') {
    return file.mode;
  }
  if (file.status === 'deleted') {
    return undefined;
  }
  return file.newMode;
}
