import { parentPort, workerData } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';

import { errorFrom } from '#x/error/error-from.ts';
import { runImpactCheck } from '#internal/impact/run-impact-check.ts';
import { createSyntaxParser } from '#internal/syntax/create-syntax-parser.ts';

import type {
  ImpactWorkerData,
  ImpactWorkerRequest,
  ImpactWorkerResponse,
} from './impact-worker-protocol.ts';

/**
 * Entry of the ImpactGate worker thread (ADR 0053): parses and measures the sources of each
 * request, one at a time, so main's event loop never waits on Tree-sitter. The runtime and the
 * grammars load on the first request and stay loaded.
 */
const port = parentPort;
if (port === null) {
  throw new Error('impact-worker must run as a worker thread');
}
const data = workerData as ImpactWorkerData;
const parser = createSyntaxParser({
  wasmDirectory: data.wasmDirectory,
  maxSourceLength: data.maxSourceLength,
});

port.on('message', (request: ImpactWorkerRequest) => {
  void answer(port, request);
});

async function answer(target: MessagePort, request: ImpactWorkerRequest): Promise<void> {
  target.postMessage(await handle(request));
}

async function handle(request: ImpactWorkerRequest): Promise<ImpactWorkerResponse> {
  try {
    const report = await runImpactCheck(request.sources, parser.parse);
    return { id: request.id, ok: true, report };
  } catch (error: unknown) {
    return {
      id: request.id,
      ok: false,
      message: errorFrom(error).message,
    };
  }
}
