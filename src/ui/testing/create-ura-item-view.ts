import type { UraItemView, UraSuggestionView } from '#contract/ipc-contract.ts';

/**
 * A suggestion to put on the view; without a placement it is current on its own lines, and
 * without an id the n-th gets `55555555-5555-4555-8555-00000000000n`.
 */
export type UraSuggestionViewOverride = Omit<UraSuggestionView, 'placement' | 'id'> &
  Partial<Pick<UraSuggestionView, 'placement' | 'id'>>;

/** Fields of the view to override; suggestions may leave out their placement. */
export type UraItemViewOverrides = Partial<Omit<UraItemView, 'suggestions'>> & {
  readonly suggestions?: readonly UraSuggestionViewOverride[];
};

/** A staged human note on `src/a.ts:3-4`, current on the head, with any field overridden. */
export function createUraItemView(overrides: UraItemViewOverrides = {}): UraItemView {
  const anchor = overrides.anchor ?? {
    kind: 'lines',
    path: 'src/a.ts',
    startLine: 3,
    endLine: 4,
  };
  const suggestions = (overrides.suggestions ?? []).map((suggestion, index): UraSuggestionView => {
    const { path, startLine, endLine } = suggestion;
    return {
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`,
      placement: { kind: 'current', path, startLine, endLine },
      ...suggestion,
    };
  });
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: '11111111-1111-4111-8111-111111111111',
    headSha: 'a'.repeat(40),
    anchor,
    placement: { kind: 'current', anchor },
    severity: 'issue',
    blocking: false,
    origin: { kind: 'human' },
    title: 'Handle the empty list',
    body: '',
    status: { kind: 'staged' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
    suggestions,
  };
}
