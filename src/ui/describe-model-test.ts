import type { ModelTestView } from '#contract/ipc-contract.ts';
import { formatDuration } from '#x/time/format-duration.ts';

/**
 * A model test's result for the Settings window: `OK · 1s 234ms · qwen3:8b`, or the error kind and
 * what it means. Pure.
 */
export function describeModelTest(
  view: ModelTestView,
  locale?: Intl.LocalesArgument,
): {
  readonly tone: 'ok' | 'warn';
  readonly text: string;
} {
  const elapsed = formatDuration(Temporal.Duration.from({ milliseconds: view.elapsedMs }), locale);
  return view.outcome === 'ok'
    ? { tone: 'ok', text: `OK · ${elapsed}${view.model === undefined ? '' : ` · ${view.model}`}` }
    : { tone: 'warn', text: `Failed (${view.errorKind}) after ${elapsed}: ${view.message}` };
}
