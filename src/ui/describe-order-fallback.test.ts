import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { ReviewOrderView } from '#contract/ipc-contract.ts';

import { describeOrderFallback } from './describe-order-fallback.ts';

function order(overrides: Partial<ReviewOrderView>): ReviewOrderView {
  return {
    sessionId: 's',
    headSha: 'h',
    requestedMode: 'calls',
    mode: 'calls',
    paths: [],
    groups: [],
    ...overrides,
  };
}

describe('describeOrderFallback', () => {
  test('says why the asked-for order fell back, and to what', ({ expect }) => {
    expect(
      describeOrderFallback(order({ mode: 'imports', fallback: { kind: 'no-language-server' } })),
    ).toBe('calls: no language server answered, so imports');
    expect(
      describeOrderFallback(
        order({ requestedMode: 'imports', mode: 'path', fallback: { kind: 'no-source-files' } }),
      ),
    ).toBe('imports: no TypeScript or JavaScript to read, so path');
  });

  test('says nothing when the order is the one asked for', ({ expect }) => {
    expect(describeOrderFallback(order({}))).toBeUndefined();
    expect(describeOrderFallback(undefined)).toBeUndefined();
  });
});
