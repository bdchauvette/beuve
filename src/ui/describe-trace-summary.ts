import type { TraceResultView } from '#contract/ipc-contract.ts';

import { countNoun } from './count-noun.ts';
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
  const parts: string[] = [];
  if (names === '') {
    parts.push('No function traced');
  } else {
    parts.push(`Traced ${names}`);
  }
  parts.push(`${countNoun(cases.length, 'test')}, ${String(reached)} reached it`);
  if (failed > 0) {
    parts.push(`${String(failed)} failed`);
  }
  parts.push(formatIsoDuration(result.duration, locale));
  return parts.filter((part) => part !== '').join(' · ');
}
