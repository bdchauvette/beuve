import { validateUraItem } from '../validate-ura-item.ts';
import type { UraItemCandidate } from '../validate-ura-item.ts';
import type { UraItem, UraItemId, UraSuggestion, UraSuggestionDraft } from '../ura-item.ts';

import { testUraIds } from './test-ura-ids.ts';

/** Fields of the test item to override; a suggestion without an id gets `suggestionId(n)`. */
export type TestUraItemOverrides = Partial<Omit<UraItemCandidate, 'suggestions'>> & {
  readonly suggestions?: readonly UraSuggestionDraft[];
};

/**
 * A valid staged human item on `src/app.ts:10-12`, with any field overridden. Throws if the
 * overrides make it invalid, so tests fail loudly on a bad fixture.
 */
export function createTestUraItem(overrides: TestUraItemOverrides = {}): UraItem {
  const suggestions = (overrides.suggestions ?? []).map(
    ({ id, ...range }, index): UraSuggestion => {
      return { id: (id ?? testUraIds.suggestionId(index + 1)) as UraSuggestion['id'], ...range };
    },
  );
  const item = validateUraItem({
    id: '22222222-2222-4222-8222-222222222222' as UraItemId,
    sessionId: testUraIds.sessionId,
    headSha: testUraIds.headSha,
    anchor: { kind: 'lines', path: 'src/app.ts', startLine: 10, endLine: 12 },
    severity: 'issue',
    blocking: false,
    origin: { kind: 'human' },
    title: 'Handle the empty list',
    body: 'An empty `items` array makes `first` undefined.',
    status: { kind: 'staged' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
    suggestions,
  });
  if (!item.ok) {
    throw new Error(`invalid test item: ${item.error.kind}: ${JSON.stringify(item.error)}`);
  }
  return item.value;
}
