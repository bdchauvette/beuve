import type { CallHierarchyRequest, CallHierarchyView, IpcResult } from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import type { DependencyEdge } from '#internal/session/order-review-files.ts';

import { headPathOf } from '../sessions/head-path-of.ts';

import { isImportSource } from './is-import-source.ts';

/** What asking the language server about the changed files produced. */
export interface CallEdges {
  readonly edges: readonly DependencyEdge[];
  /** Queries a server answered, even with no calls. */
  readonly answered: number;
  /** Queries that found no language server for the file. */
  readonly unsupported: number;
}

/** The most files and, per file, hunks asked about: each is a language server round trip. */
const maxFiles = 40;
const maxHunksPerFile = 3;
const parallelism = 4;

/**
 * `caller calls callee` between the changed files in `paths` (ADR 0065), from the language
 * server's outgoing calls. For each changed TypeScript or JavaScript file (up to {@link maxFiles})
 * it asks for the outgoing calls of the function around the first added line of each of its first
 * {@link maxHunksPerFile} hunks, and keeps calls into other changed files. A file whose changes
 * touch no function adds no edge. Every query is pinned to `headSha`, the head the diff is of.
 */
export async function buildCallEdges(
  callHierarchy: (request: CallHierarchyRequest) => Promise<IpcResult<CallHierarchyView>>,
  sessionId: string,
  headSha: string,
  files: readonly DiffFile[],
  paths: ReadonlySet<string>,
): Promise<CallEdges> {
  const queries = files
    .filter((file) => file.status !== 'deleted' && paths.has(headPathOf(file)))
    .filter((file) => isImportSource(headPathOf(file)))
    .slice(0, maxFiles)
    .flatMap((file) => firstAddedLines(file).map((line) => ({ path: headPathOf(file), line })));
  const seen = new Set<string>();
  const edges: DependencyEdge[] = [];
  let answered = 0;
  let unsupported = 0;
  const queue = [...queries];
  const worker = async (): Promise<void> => {
    for (let query = queue.shift(); query !== undefined; query = queue.shift()) {
      const result = await callHierarchy({
        sessionId,
        expectedHeadSha: headSha,
        path: query.path,
        line: query.line,
        direction: 'outgoing',
      });
      if (result.ok) {
        answered += 1;
        for (const { node } of result.value.calls) {
          const callee = node.file.kind === 'workspace' ? node.file.path : undefined;
          const key = `${query.path}\0${callee ?? ''}`;
          if (
            callee === undefined ||
            callee === query.path ||
            !paths.has(callee) ||
            seen.has(key)
          ) {
            continue;
          }
          seen.add(key);
          edges.push({ dependent: query.path, dependency: callee });
        }
      } else if (result.error.code === 'unsupported') {
        unsupported += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallelism, queries.length) }, worker));
  return { edges, answered, unsupported };
}

function firstAddedLines(file: DiffFile): number[] {
  const lines: number[] = [];
  for (const hunk of file.hunks.slice(0, maxHunksPerFile)) {
    const added = hunk.lines.find((line) => line.kind === 'added');
    if (added?.kind === 'added') {
      lines.push(added.newLine);
    }
  }
  return lines;
}
