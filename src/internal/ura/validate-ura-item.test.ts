import { describe } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type {
  UraAnchor,
  UraItem,
  UraItemError,
  UraOrigin,
  UraSuggestion,
  UraSuggestionDraft,
} from './ura-item.ts';
import { validateUraItem } from './validate-ura-item.ts';
import type { UraItemCandidate } from './validate-ura-item.ts';
import { test } from './testing/test.ts';

/** Fields of the candidate to override; a suggestion without an id gets `suggestionId(n)`. */
type CandidateOverrides = Partial<Omit<UraItemCandidate, 'suggestions'>> & {
  readonly suggestions?: readonly UraSuggestionDraft[];
};

function errorOf({ suggestions = [], ...overrides }: CandidateOverrides): UraItemError | undefined {
  const identified = suggestions.map(({ id, ...range }, index): UraSuggestion => {
    return { id: (id ?? testUraIds.suggestionId(index + 1)) as UraSuggestion['id'], ...range };
  });
  const result = validateUraItem({ ...candidate(), ...overrides, suggestions: identified });
  if (result.ok) {
    return undefined;
  }
  return result.error;
}

describe('validateUraItem', () => {
  test('accepts a valid item, with suggestions anywhere on the head', ({ expect }) => {
    expect(validateUraItem(candidate())).toStrictEqual({ ok: true, value: valid() });
    const suggestions = [
      suggestion({ path: 'lib/other.ts', startLine: 400, endLine: 401 }),
      suggestion({ startLine: 1, endLine: 0 }),
      suggestion({ startLine: 1, endLine: 3, replacement: '' }),
      suggestion({ startLine: 4, endLine: 3 }),
    ];
    expect(errorOf({ suggestions })).toBeUndefined();
    expect(
      errorOf({ anchor: { kind: 'change' }, title: '', body: '', suggestions }),
    ).toBeUndefined();
  });

  test.for<[string, UraAnchor]>([
    ['empty path', { kind: 'file', path: '' }],
    ['absolute path', { kind: 'file', path: '/etc/passwd' }],
    ['parent segment', { kind: 'file', path: 'src/../x' }],
    ['dot segment', { kind: 'file', path: './x' }],
    ['trailing slash', { kind: 'file', path: 'src/' }],
    ['newline', { kind: 'file', path: 'a\nb' }],
    ['line zero', { kind: 'lines', path: 'a', startLine: 0, endLine: 1 }],
    ['fractional line', { kind: 'lines', path: 'a', startLine: 1.5, endLine: 2 }],
    ['reversed range', { kind: 'lines', path: 'a', startLine: 5, endLine: 4 }],
  ])('rejects an anchor with a %s', ([, anchor], { expect }) => {
    expect(errorOf({ anchor })?.kind).toBe('invalid-anchor');
  });

  test('accepts whole-file and whole-change anchors', ({ expect }) => {
    expect(errorOf({ anchor: { kind: 'file', path: 'docs/a b.md' } })).toBeUndefined();
    expect(errorOf({ anchor: { kind: 'change' } })).toBeUndefined();
  });

  test.for<[string, UraOrigin, UraAnchor?]>([
    ['negative finding index', { kind: 'chat-answer', messageId: 'm1', finding: -1 }],
    [
      'review finding on a file',
      { kind: 'chat-answer', messageId: 'm1', finding: 0 },
      {
        kind: 'file',
        path: 'a',
      },
    ],
    ['empty chat message id', { kind: 'chat-answer', messageId: ' ', finding: 0 }],
    ['whole answer, neither finding nor proposal', { kind: 'chat-answer', messageId: 'm1' }],
    ['negative proposal index', { kind: 'chat-answer', messageId: 'm1', proposal: -1 }],
    ['finding and proposal', { kind: 'chat-answer', messageId: 'm1', finding: 0, proposal: 0 }],
    ['confidence above 1', { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: 1.5 }],
    ['negative confidence', { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: -0.5 }],
    [
      'confidence that is not a number',
      { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: NaN },
    ],
    [
      'confidence on a proposed note',
      { kind: 'chat-answer', messageId: 'm1', proposal: 0, confidence: 0.5 },
    ],
    [
      'proposed note on the whole change',
      { kind: 'chat-answer', messageId: 'm1', proposal: 0 },
      { kind: 'change' },
    ],
  ])('rejects an origin with a %s', ([, origin, anchor], { expect }) => {
    expect(errorOf({ origin, ...(anchor && { anchor }) })?.kind).toBe('invalid-origin');
  });

  test('accepts valid origins', ({ expect }) => {
    expect(
      errorOf({ origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 3 } }),
    ).toBeUndefined();
    expect(
      errorOf({ origin: { kind: 'chat-answer', messageId: 'm1', proposal: 0 } }),
    ).toBeUndefined();
    expect(
      errorOf({ origin: { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: 0 } }),
    ).toBeUndefined();
    expect(
      errorOf({ origin: { kind: 'chat-answer', messageId: 'm1', finding: 0, confidence: 1 } }),
    ).toBeUndefined();
  });

  test.for([' padded ', 'two\nlines', 'x'.repeat(201)])(
    'rejects the title %j',
    (title, { expect }) => {
      expect(errorOf({ title })?.kind).toBe('invalid-text');
    },
  );

  test('allows an empty body', ({ expect }) => {
    expect(errorOf({ body: '' })).toBeUndefined();
  });

  test('allows an empty title when the body says something', ({ expect }) => {
    expect(errorOf({ title: '' })).toBeUndefined();
  });

  test('refuses an item with no title, no body and no suggestion', ({ expect }) => {
    expect(errorOf({ title: '', body: ' \n' })).toMatchObject({ kind: 'invalid-text' });
  });

  test('refuses an item addressed at the head it was written against', ({ expect }) => {
    expect(
      errorOf({ status: { kind: 'addressed', atSha: testUraIds.headSha, by: 'agent' } })?.kind,
    ).toBe('invalid-transition');
    expect(
      errorOf({ status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'agent' } }),
    ).toBeUndefined();
  });

  test.for<[string, readonly UraSuggestionDraft[], string]>([
    ['a bad path', [suggestion({ path: 'src/../x' })], "a suggestion's path: "],
    ['line zero', [suggestion({ startLine: 0, endLine: 0 })], 'must be positive integers'],
    ['a fractional line', [suggestion({ endLine: 2.5 })], 'must be positive integers'],
    [
      'an end before the insertion point',
      [suggestion({ startLine: 5, endLine: 3 })],
      'comes before',
    ],
    [
      'an empty insertion',
      [suggestion({ startLine: 5, endLine: 4, replacement: '' })],
      'adds at least',
    ],
    ['an id that is no UUID', [suggestion({ id: 'nope' })], "a suggestion's id is a UUID"],
    [
      'one id twice',
      [
        suggestion({ id: testUraIds.suggestionId(1) }),
        suggestion({ id: testUraIds.suggestionId(1), startLine: 9, endLine: 9 }),
      ],
      'distinct ids',
    ],
    [
      'shared lines',
      [suggestion({ startLine: 1, endLine: 5 }), suggestion({ startLine: 5, endLine: 6 })],
      'must not overlap',
    ],
    [
      'a line inside a longer range',
      [
        suggestion({ startLine: 1, endLine: 10 }),
        suggestion({ startLine: 2, endLine: 3 }),
        suggestion({ startLine: 7, endLine: 7 }),
      ],
      'must not overlap',
    ],
    [
      'an insertion between a range’s lines',
      [suggestion({ startLine: 1, endLine: 5 }), suggestion({ startLine: 3, endLine: 2 })],
      'must not overlap',
    ],
    [
      'two insertions at one place',
      [
        suggestion({ startLine: 3, endLine: 2 }),
        suggestion({ startLine: 3, endLine: 2, replacement: 'y' }),
      ],
      'must not overlap',
    ],
    [
      'a replacement over 64 KiB',
      [suggestion({ replacement: 'é'.repeat(32 * 1024 + 1) })],
      'at most 64 KiB',
    ],
    ['more than 500', suggestionsOnLines(501), 'at most 500 suggestions'],
  ])('refuses suggestions with %s', ([, suggestions, reason], { expect }) => {
    const error = errorOf({ suggestions });
    expect(error?.kind).toBe('invalid-suggestion');
    expect(error?.reason).toContain(reason);
  });

  test('lets suggestions touch: an insertion right before or after, the same lines on another path', ({
    expect,
  }) => {
    const suggestions = [
      suggestion({ startLine: 3, endLine: 2 }),
      suggestion({ startLine: 3, endLine: 5 }),
      suggestion({ startLine: 6, endLine: 5 }),
      suggestion({ startLine: 6, endLine: 6 }),
      suggestion({ path: 'src/b.ts', startLine: 3, endLine: 5 }),
    ];
    expect(errorOf({ suggestions })).toBeUndefined();
    expect(errorOf({ suggestions: suggestionsOnLines(500) })).toBeUndefined();
  });
});

function suggestion(overrides: Partial<UraSuggestionDraft>): UraSuggestionDraft {
  return { path: 'src/app.ts', startLine: 1, endLine: 1, replacement: 'x', ...overrides };
}

function suggestionsOnLines(count: number): UraSuggestionDraft[] {
  return Array.from({ length: count }, (_, index) => {
    return suggestion({ startLine: index + 1, endLine: index + 1 });
  });
}

function valid(): UraItem {
  return createTestUraItem();
}

function candidate(): UraItemCandidate {
  return valid();
}
