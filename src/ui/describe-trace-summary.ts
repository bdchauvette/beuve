import type { TraceResultView } from '#contract/ipc-contract.ts';

import { formatIsoDuration } from './format-iso-duration.ts';
import type { TraceCase } from './plan-trace-timeline.ts';

/** The line under the heading: which functions were traced and how the tests went. */
export function describeTraceSummary(
  result: TraceResultView,
  cases: readonly TraceCase[],
  locale?: Intl.LocalesArgument,
): string {
  const names = result.functions.map((fn) => fn.name).join(', ');
  const failed = cases.filter((testCase) => testCase.status === 'failed').length;
  const reached = cases.filter((testCase) => testCase.rows.length > 0).length;
  const count = cases.length;
  return [
    names === '' ? 'No function traced' : `Traced ${names}`,
    `${String(count)} ${count === 1 ? 'test' : 'tests'}, ${String(reached)} reached it`,
    failed > 0 ? `${String(failed)} failed` : '',
    formatIsoDuration(result.duration, locale),
  ]
    .filter((part) => part !== '')
    .join(' · ');
}
