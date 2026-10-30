import { describe } from 'vitest';

import { test } from './testing/test.ts';
import { toInsightMarkCss } from './to-insight-mark-css.ts';

describe('toInsightMarkCss', () => {
  test('is empty without marks', ({ expect }) => {
    expect(toInsightMarkCss('split', [])).toBe('');
  });

  test('marks the head column when split and leaves deleted lines alone when inline', ({
    expect,
  }) => {
    const marks = [{ line: 7, severity: 'risk' }] as const;
    const split = toInsightMarkCss('split', marks);
    expect(split).toContain("code[data-additions] [data-column-number='7']");
    expect(split).toContain('var(--beuve-danger)');
    const inline = toInsightMarkCss('unified', marks);
    expect(inline).toContain("code[data-unified] [data-column-number='7']");
    expect(inline).toContain(":not([data-line-type='change-deletion'])");
  });

  test('colours each severity differently', ({ expect }) => {
    const css = toInsightMarkCss('split', [
      { line: 1, severity: 'risk' },
      { line: 2, severity: 'warning' },
      { line: 3, severity: 'info' },
    ]);
    expect(css).toContain('var(--beuve-danger)');
    expect(css).toContain('var(--beuve-warn)');
    expect(css).toContain('var(--beuve-text-muted)');
  });
});
