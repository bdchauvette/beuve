import type { ModelTestView } from '#contract/ipc-contract.ts';
import { formatDuration } from '#x/time/format-duration.ts';

/** What the Settings window shows after a model test. */
export interface ModelTestNotice {
  readonly tone: 'ok' | 'warn';
  readonly text: string;
}

/**
 * A model test's result for the Settings window: `OK · 1s 234ms · qwen3:8b`, or the error kind and
 * what it means. Pure.
 */
export function describeModelTest(
  view: ModelTestView,
  locale?: Intl.LocalesArgument,
): ModelTestNotice {
  const elapsed = formatDuration(Temporal.Duration.from({ milliseconds: view.elapsedMs }), locale);
  if (view.outcome === 'ok') {
    const parts = ['OK', elapsed];
    if (view.model !== undefined) {
      parts.push(view.model);
    }
    return { tone: 'ok', text: parts.join(' · ') };
  }
  return { tone: 'warn', text: `Failed (${view.errorKind}) after ${elapsed}: ${view.message}` };
}
