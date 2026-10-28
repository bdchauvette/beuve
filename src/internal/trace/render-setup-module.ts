import { createTraceRecorder } from './create-trace-recorder.ts';
import type { TraceRecorderLimits } from './create-trace-recorder.ts';
import { defaultRecorderLimits } from './default-recorder-limits.ts';
import { traceGlobalName } from './trace-global-name.ts';

/**
 * The Vitest setup module beuve injects (ADR 0036): it installs the recorder as
 * `globalThis.__beuveTrace`, attributes events to the running test, and appends one JSON line per
 * test to `events-<pid>-<thread>.jsonl` in `eventsDirectory`, so workers never share a file.
 */
export function renderSetupModule(
  eventsDirectory: string,
  limits: TraceRecorderLimits = defaultRecorderLimits,
): string {
  return `import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { afterAll, afterEach, beforeEach } from 'vitest';

const createTraceRecorder = ${String(createTraceRecorder)};
const recorder = createTraceRecorder(${JSON.stringify(limits)});
globalThis[${JSON.stringify(traceGlobalName)}] = recorder;
const eventsFile = join(${JSON.stringify(eventsDirectory)}, \`events-\${process.pid}-\${threadId}.jsonl\`);
const flush = () => {
  const record = recorder.take();
  if (record !== undefined) {
    appendFileSync(eventsFile, JSON.stringify(record) + '\\n');
  }
};
const titlesOf = (task) => {
  const titles = [];
  for (let current = task; current !== undefined && current.filepath === undefined; current = current.suite) {
    titles.unshift(current.name);
  }
  return titles;
};
beforeEach((context) => {
  flush();
  recorder.setTest({ file: context.task.file?.filepath ?? '', titles: titlesOf(context.task) });
});
afterEach(() => {
  flush();
  recorder.setTest(undefined);
});
afterAll(() => {
  flush();
});
`;
}
