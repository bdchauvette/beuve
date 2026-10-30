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

/**
 * `dependent imports dependency` between the changed files in `paths` (ADR 0065): each changed
 * TypeScript or JavaScript file's head blob is parsed for imports, exports-from, `import()` and
 * `require()`, and each specifier is resolved against the head tree. Imports of unchanged files,
 * packages and unreadable files add no edge. Type-only imports count: the types are part of what
 * the reader must know first.
 */
export async function buildImportEdges(
  repository: GitRepository,
  parse: ParseSyntax,
  resolve: ModuleResolver,
  files: readonly DiffFile[],
  paths: ReadonlySet<string>,
): Promise<Result<readonly DependencyEdge[], GitError>> {
  const sources = files.filter(
    (file) =>
      file.status !== 'deleted' && paths.has(headPathOf(file)) && isImportSource(headPathOf(file)),
  );
  const requests = sources
    .filter((file) => file.newObject !== undefined)
    .map((file) => ({ objectId: file.newObject ?? '', mode: newModeOf(file) }));
  const blobs = await readBlobs(repository, requests);
  if (!blobs.ok) {
    return blobs;
  }
  const edges: DependencyEdge[] = [];
  for (const file of sources) {
    const content = file.newObject === undefined ? undefined : blobs.value.get(file.newObject);
    if (content?.kind !== 'text') {
      continue;
    }
    const dependent = headPathOf(file);
    const parsed = await parse(dependent, content.text, (root) =>
      extractModuleReferences(root).map((reference) => reference.specifier),
    );
    const specifiers = parsed.ok ? new Set(parsed.value) : new Set<string>();
    for (const specifier of specifiers) {
      const dependency = resolve(specifier, dependent);
      if (dependency !== undefined && dependency !== dependent && paths.has(dependency)) {
        edges.push({ dependent, dependency });
      }
    }
  }
  return ok(edges);
}

function newModeOf(file: DiffFile): string | undefined {
  return file.status === 'added' ? file.mode : file.status === 'deleted' ? undefined : file.newMode;
}
