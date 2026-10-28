import type {
  FlowFailureKind,
  FlowGraphResponse,
  FlowGraphView,
  GetFlowGraphRequest,
  IpcResult,
} from '#contract/ipc-contract.ts';
import type { DiffFile } from '#internal/git/diff-model.ts';
import { readBlobs } from '#internal/git/read-blobs.ts';
import { buildControlFlowGraph } from '#internal/flow/build-control-flow-graph.ts';
import { findFunctionAt } from '#internal/flow/find-function-at.ts';
import { flowRulesByLanguage } from '#internal/flow/flow-rules-by-language.ts';
import type { ParseSyntax } from '#internal/syntax/create-syntax-parser.ts';
import { detectLanguage } from '#internal/syntax/detect-language.ts';
import { LruCache } from '#pkg/datastructures/lru-cache.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';

import { gitFailure } from '../sessions/git-failure.ts';
import { loadReviewDiff } from '../sessions/load-review-diff.ts';
import type { SessionContext } from '../sessions/session-context.ts';

import { toFlowChangedLines } from './to-flow-changed-lines.ts';

/** Control-flow graphs for the renderer's `Shift+p` (ADR 0028, 0029). */
export interface FlowServices {
  readonly getGraph: (request: GetFlowGraphRequest) => Promise<IpcResult<FlowGraphResponse>>;
}

export interface FlowServicesOptions {
  readonly context: SessionContext;
  /** The syntax domain's `SyntaxParser.parse`. */
  readonly parse: ParseSyntax;
  /** Graphs kept, one per (head blob, base blob, function start line). Defaults to 64. */
  readonly cacheSize?: number;
}

const zeroIdPattern = /^0+$/u;

/**
 * `flow:get-graph` reads the head blob of one file of the review, parses it, finds the function
 * enclosing the line and builds its graph, marking the head-side lines the review changed. Graphs
 * are cached per (head blob, base blob, function start line): the blob pair fixes the changed
 * lines, so a repeat for any line of the same function costs a map lookup after the first one
 * has told us which function the line belongs to. Failures are not cached.
 */
export function createFlowServices(options: FlowServicesOptions): FlowServices {
  const { context, parse } = options;
  const size = options.cacheSize ?? 64;
  const graphs = new LruCache<string, FlowGraphView>(size);
  const functionStarts = new LruCache<string, number>(size * 4);

  return {
    getGraph: async ({ sessionId, path, line }): Promise<IpcResult<FlowGraphResponse>> => {
      const diff = await loadReviewDiff(context, sessionId);
      if (!diff.ok) {
        return diff;
      }
      const file = diff.value.files.find((candidate) => headPath(candidate) === path);
      if (file === undefined) {
        return err({ code: 'not-found', message: 'that file is not in the review' });
      }
      const language = detectLanguage(path);
      if (language === undefined || flowRulesByLanguage[language] === undefined) {
        return failed('unsupported-language', `there are no control-flow rules for ${path}`);
      }
      const blobId = file.status === 'deleted' ? undefined : file.newObject;
      if (blobId === undefined || file.submodule || file.binary || zeroIdPattern.test(blobId)) {
        return failed('file-unavailable', `${path} has no readable text at the head`);
      }
      const baseKey = `${blobId}\0${file.status === 'added' ? '' : (file.oldObject ?? '')}`;
      const knownStart = functionStarts.get(`${baseKey}\0${String(line)}`);
      const cached =
        knownStart === undefined ? undefined : graphs.get(`${baseKey}\0${String(knownStart)}`);
      if (cached !== undefined) {
        return ok({ kind: 'graph', graph: cached });
      }

      const blobs = await readBlobs(diff.value.refreshed.repository, [{ objectId: blobId }]);
      if (!blobs.ok) {
        return gitFailure(context.logger, blobs.error);
      }
      const blob = blobs.value.get(blobId);
      if (blob?.kind !== 'text') {
        return failed('file-unavailable', `${path} has no readable text at the head`);
      }
      const changedLines = toFlowChangedLines(file);
      const built = await parse(path, blob.text, (root, parsedLanguage): FlowGraphResponse => {
        const rules = flowRulesByLanguage[parsedLanguage];
        if (rules === undefined) {
          return unsupported(path);
        }
        const found = findFunctionAt(root, line, rules);
        if (found === undefined) {
          return noFunction(path, line);
        }
        const graph = buildControlFlowGraph(found, rules, { changedLines });
        if (graph.ok) {
          return { kind: 'graph', graph: graph.value };
        }
        return graph.error.kind === 'too-large'
          ? tooLarge(graph.error.nodeLimit)
          : noFunction(path, line);
      });
      if (!built.ok) {
        switch (built.error.kind) {
          case 'unsupported-language': {
            return ok(unsupported(path));
          }
          case 'too-large': {
            return failed('file-unavailable', `${path} is too large to analyse`);
          }
          case 'load-failed': {
            context.logger.error('flow parse failed', { error: built.error });
            return err({ code: 'internal', message: 'the syntax parser could not be loaded' });
          }
        }
      }
      if (built.value.kind === 'graph') {
        const { graph } = built.value;
        graphs.set(`${baseKey}\0${String(graph.startLine)}`, graph);
        functionStarts.set(`${baseKey}\0${String(line)}`, graph.startLine);
      }
      return ok(built.value);
    },
  };
}

function headPath(file: DiffFile): string {
  return 'newPath' in file ? file.newPath : file.path;
}

function failed(failure: FlowFailureKind, message: string): IpcResult<FlowGraphResponse> {
  return ok({ kind: 'failed', failure, message });
}

function unsupported(path: string): FlowGraphResponse {
  return {
    kind: 'failed',
    failure: 'unsupported-language',
    message: `there are no control-flow rules for ${path}`,
  };
}

function noFunction(path: string, line: number): FlowGraphResponse {
  return {
    kind: 'failed',
    failure: 'no-function-at-line',
    message: `no function with a body encloses line ${String(line)} of ${path}`,
  };
}

function tooLarge(nodeLimit: number): FlowGraphResponse {
  return {
    kind: 'failed',
    failure: 'too-large',
    message: `this function has more than ${String(nodeLimit)} steps to draw`,
  };
}
