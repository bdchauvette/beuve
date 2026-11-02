import { describe } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraAnchor, UraItem, UraItemError, UraOrigin } from './ura-item.ts';
import { validateUraItem } from './validate-ura-item.ts';
import type { UraItemCandidate } from './validate-ura-item.ts';
import { test } from './testing/test.ts';

function errorOf(overrides: Partial<UraItemCandidate>): UraItemError | undefined {
  const result = validateUraItem({ ...candidate(), ...overrides });
  if (result.ok) {
    return undefined;
  }
  return result.error;
}

describe('validateUraItem', () => {
  test('accepts a valid item and parses its patch', ({ expect }) => {
    expect(validateUraItem(candidate())).toStrictEqual({ ok: true, value: valid() });
    const result = validateUraItem({ ...candidate(), suggestion: '@@ -11 +11 @@\n-a\n+b\n' });
    expect(result.ok && result.value.suggestion?.path).toBe('src/app.ts');
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
    ['empty chat message id', { kind: 'chat-answer', messageId: ' ' }],
    ['finding on a file', finding(), { kind: 'file', path: 'a' }],
    ['finding without a function', { ...finding(), functionName: '' }],
    ['finding with NaN', { ...finding(), value: NaN }],
    ['finding with a percentile over 100', { ...finding(), percentile: 101 }],
  ])('rejects an origin with a %s', ([, origin, anchor], { expect }) => {
    expect(errorOf({ origin, ...(anchor && { anchor }) })?.kind).toBe('invalid-origin');
  });

  test('accepts valid origins', ({ expect }) => {
    expect(errorOf({ origin: finding() })).toBeUndefined();
    expect(
      errorOf({ origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 3 } }),
    ).toBeUndefined();
    expect(errorOf({ origin: { kind: 'chat-answer', messageId: 'm1' } })).toBeUndefined();
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

  test('refuses a patch that does not fit the anchor', ({ expect }) => {
    expect(errorOf({ suggestion: '@@ -1 +1 @@\n-a\n+b\n' })).toStrictEqual({
      kind: 'invalid-patch',
      reason: 'the patch changes lines outside 10–12',
    });
    expect(errorOf({ anchor: { kind: 'change' }, suggestion: '@@ -1 +1 @@\n-a\n+b\n' })?.kind).toBe(
      'invalid-patch',
    );
  });
});

function valid(): UraItem {
  return createTestUraItem();
}

function candidate(): UraItemCandidate {
  return { ...valid(), suggestion: undefined };
}

function finding(): Extract<UraOrigin, { kind: 'impact-finding' }> {
  return {
    kind: 'impact-finding',
    metric: 'cognitive-complexity',
    functionName: 'f',
    value: 20,
    threshold: 15,
    percentile: 50,
  };
}
