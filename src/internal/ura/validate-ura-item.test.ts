import { describe, expect, it } from 'vitest';

import { createTestUraItem } from './testing/create-test-ura-item.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import type { UraAnchor, UraItemError, UraOrigin } from './ura-item.ts';
import { validateUraItem } from './validate-ura-item.ts';
import type { UraItemCandidate } from './validate-ura-item.ts';

const valid = createTestUraItem();
const candidate: UraItemCandidate = { ...valid, suggestion: undefined };

function errorOf(overrides: Partial<UraItemCandidate>): UraItemError | undefined {
  const result = validateUraItem({ ...candidate, ...overrides });
  return result.ok ? undefined : result.error;
}

const finding: UraOrigin = {
  kind: 'impact-finding',
  metric: 'cognitive-complexity',
  functionName: 'f',
  value: 20,
  threshold: 15,
  percentile: 50,
};

describe('validateUraItem', () => {
  it('accepts a valid item and parses its patch', () => {
    expect(validateUraItem(candidate)).toEqual({ ok: true, value: valid });
    const result = validateUraItem({ ...candidate, suggestion: '@@ -11 +11 @@\n-a\n+b\n' });
    expect(result.ok && result.value.suggestion?.path).toBe('src/app.ts');
  });

  it.each<[string, UraAnchor]>([
    ['empty path', { kind: 'file', path: '' }],
    ['absolute path', { kind: 'file', path: '/etc/passwd' }],
    ['parent segment', { kind: 'file', path: 'src/../x' }],
    ['dot segment', { kind: 'file', path: './x' }],
    ['trailing slash', { kind: 'file', path: 'src/' }],
    ['newline', { kind: 'file', path: 'a\nb' }],
    ['line zero', { kind: 'lines', path: 'a', startLine: 0, endLine: 1 }],
    ['fractional line', { kind: 'lines', path: 'a', startLine: 1.5, endLine: 2 }],
    ['reversed range', { kind: 'lines', path: 'a', startLine: 5, endLine: 4 }],
  ])('rejects an anchor with a %s', (_name, anchor) => {
    expect(errorOf({ anchor })?.kind).toBe('invalid-anchor');
  });

  it('accepts whole-file and whole-change anchors', () => {
    expect(errorOf({ anchor: { kind: 'file', path: 'docs/a b.md' } })).toBeUndefined();
    expect(errorOf({ anchor: { kind: 'change' } })).toBeUndefined();
  });

  it.each<[string, UraOrigin, UraAnchor?]>([
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
    ['finding on a file', finding, { kind: 'file', path: 'a' }],
    ['finding without a function', { ...finding, functionName: '' }],
    ['finding with NaN', { ...finding, value: NaN }],
    ['finding with a percentile over 100', { ...finding, percentile: 101 }],
  ])('rejects an origin with a %s', (_name, origin, anchor) => {
    expect(errorOf({ origin, ...(anchor && { anchor }) })?.kind).toBe('invalid-origin');
  });

  it('accepts valid origins', () => {
    expect(errorOf({ origin: finding })).toBeUndefined();
    expect(
      errorOf({ origin: { kind: 'chat-answer', messageId: testUraIds.messageId, finding: 3 } }),
    ).toBeUndefined();
    expect(errorOf({ origin: { kind: 'chat-answer', messageId: 'm1' } })).toBeUndefined();
  });

  it.each(['', ' padded ', 'two\nlines', 'x'.repeat(201)])('rejects the title %j', (title) => {
    expect(errorOf({ title })?.kind).toBe('invalid-text');
  });

  it('allows an empty body', () => {
    expect(errorOf({ body: '' })).toBeUndefined();
  });

  it('refuses an item addressed at the head it was written against', () => {
    expect(
      errorOf({ status: { kind: 'addressed', atSha: testUraIds.headSha, by: 'agent' } })?.kind,
    ).toBe('invalid-transition');
    expect(
      errorOf({ status: { kind: 'addressed', atSha: testUraIds.laterHeadSha, by: 'agent' } }),
    ).toBeUndefined();
  });

  it('refuses a patch that does not fit the anchor', () => {
    expect(errorOf({ suggestion: '@@ -1 +1 @@\n-a\n+b\n' })).toEqual({
      kind: 'invalid-patch',
      reason: 'the patch changes lines outside 10–12',
    });
    expect(errorOf({ anchor: { kind: 'change' }, suggestion: '@@ -1 +1 @@\n-a\n+b\n' })?.kind).toBe(
      'invalid-patch',
    );
  });
});
