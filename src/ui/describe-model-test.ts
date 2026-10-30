import type { ModelTestView } from '#contract/ipc-contract.ts';

/**
 * A model test's result for the Settings window: `OK · 1.2 s · qwen3:8b`, or the error kind and
 * what it means. Pure.
 */
export function describeModelTest(view: ModelTestView): {
  readonly tone: 'ok' | 'warn';
  readonly text: string;
} {
  const seconds = `${(view.elapsedMs / 1000).toFixed(1)} s`;
  return view.outcome === 'ok'
    ? { tone: 'ok', text: `OK · ${seconds}${view.model === undefined ? '' : ` · ${view.model}`}` }
    : { tone: 'warn', text: `Failed (${view.errorKind}) after ${seconds}: ${view.message}` };
}
