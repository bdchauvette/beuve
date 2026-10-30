import { parentPort } from 'node:worker_threads';

import type { ImpactReport } from '#internal/impact/impact-report.ts';

import type { ImpactWorkerRequest } from '../impact-worker-protocol.ts';

const delayPattern = /^delay-(\d+)$/u;
const emptyReport: ImpactReport = {
  cognitiveMax: 15,
  population: 0,
  files: [],
  findings: [],
  totals: {
    analyzedFiles: 0,
    skippedFiles: 0,
    added: 0,
    removed: 0,
    modified: 0,
    cognitiveDelta: 0,
    findings: 0,
  },
};

/**
 * A stand-in worker for the runner's tests: the first source's path scripts the behavior. `crash`
 * throws, `exit` ends the thread, `hang` never answers, `fail` reports an error, anything else
 * answers with an empty report after `delay-<ms>` if the path says so.
 */
parentPort?.on('message', (request: ImpactWorkerRequest) => {
  const path = request.sources[0]?.path ?? '';
  if (path === 'crash') {
    throw new Error('scripted crash');
  }
  if (path === 'hang') {
    return;
  }
  if (path === 'fail') {
    parentPort?.postMessage({ id: request.id, ok: false, message: 'scripted failure' });
    return;
  }
  const delayMs = Number(delayPattern.exec(path)?.[1] ?? 0);
  setTimeout(() => {
    parentPort?.postMessage({ id: request.id, ok: true, report: emptyReport });
  }, delayMs);
});
