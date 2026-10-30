import type { ChatFindingView } from '#contract/ipc-contract.ts';

/** A confirmed `edge-case` warning on `src/a.ts:3-4`, with any field overridden. */
export function createFindingView(overrides: Partial<ChatFindingView> = {}): ChatFindingView {
  return {
    path: 'src/a.ts',
    startLine: 3,
    endLine: 4,
    severity: 'warning',
    category: 'edge-case',
    title: 'Empty list falls through',
    body: 'The loop never runs for `[]`.',
    confidence: 0.8,
    check: 'confirmed',
    ...overrides,
  };
}
