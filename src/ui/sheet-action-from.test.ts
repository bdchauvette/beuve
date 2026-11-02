import { describe } from 'vitest';

import type { ClickedToken } from './run-sheet-action.ts';
import { sheetActionFrom } from './sheet-action-from.ts';
import type { ReviewTarget } from './target-from.ts';
import { test } from './testing/test.ts';

function targetOf(): ReviewTarget {
  return { kind: 'change' } as unknown as ReviewTarget;
}

function tokenOf(): ClickedToken {
  return { text: 'x' } as unknown as ClickedToken;
}

describe('sheetActionFrom', () => {
  test.for([
    ['open-definition', 'definition'],
    ['open-type-definition', 'type-definition'],
  ] as const)('%s asks about the clicked token', ([id, kind], { expect }) => {
    const target = targetOf();
    const token = tokenOf();
    expect(sheetActionFrom(id, target, token)).toStrictEqual({ kind, target, token });
    expect(sheetActionFrom(id, target, undefined)).toStrictEqual({
      kind,
      target,
      token: undefined,
    });
  });

  test.for([
    ['copy-permalink', 'copy-link'],
    ['open-permalink', 'open-link'],
  ] as const)('%s ignores the token', ([id, kind], { expect }) => {
    const target = targetOf();
    expect(sheetActionFrom(id, target, tokenOf())).toStrictEqual({ kind, target });
  });
});
