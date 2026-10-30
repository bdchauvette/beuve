import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { sheetGutterCssFrom } from './sheet-gutter-css-from.ts';

describe('sheetGutterCssFrom', () => {
  test('draws added, modified and removed marks on line numbers', ({ expect }) => {
    const css = sheetGutterCssFrom({
      marks: {
        added: [{ startLine: 2, endLine: 3 }],
        modified: [{ startLine: 7, endLine: 7 }],
        deletedAt: [9],
      },
      notes: [],
      matchLines: [],
      currentMatchLine: undefined,
    });
    expect(css).toContain(
      "[data-column-number='2']{box-shadow:inset 3px 0 0 var(--beuve-diff-added-bar)}",
    );
    expect(css).toContain("[data-column-number='3']{box-shadow");
    expect(css).toContain("[data-column-number='7']{box-shadow:inset 3px 0 0 var(--beuve-accent)}");
    expect(css).toContain("[data-column-number='9']::after");
    expect(css).not.toContain("'4'");
  });

  test('marks notes and find matches, the current match strongest', ({ expect }) => {
    const css = sheetGutterCssFrom({
      marks: noMarks(),
      notes: [{ startLine: 4, endLine: 4, severity: 'issue', title: 'Check' }],
      matchLines: [5, 5, 6],
      currentMatchLine: 6,
    });
    expect(css).toContain("[data-column-number='4']::before");
    expect(css.match(/\[data-line='5'\]/gu)).toHaveLength(1);
    expect(css).toContain(
      "[data-line='6']{background-image:linear-gradient(var(--beuve-accent-soft)",
    );
  });

  test('is empty when there is nothing to draw', ({ expect }) => {
    expect(
      sheetGutterCssFrom({
        marks: noMarks(),
        notes: [],
        matchLines: [],
        currentMatchLine: undefined,
      }),
    ).toBe('');
  });
});

function noMarks(): { added: never[]; modified: never[]; deletedAt: never[] } {
  return { added: [], modified: [], deletedAt: [] };
}
