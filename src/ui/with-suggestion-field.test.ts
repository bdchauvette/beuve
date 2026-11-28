import { describe } from 'vitest';

import type { SuggestionFieldView } from './suggestion-field-view.ts';
import { test } from './testing/test.ts';
import { withSuggestionField } from './with-suggestion-field.ts';

function fieldOn(path: string, lines: readonly [number, number]): SuggestionFieldView {
  return {
    key: `${path}:${String(lines[0])}`,
    headSha: 'a'.repeat(40),
    path,
    startLine: lines[0],
    endLine: lines[1],
  };
}

describe('withSuggestionField', () => {
  test('adds a field that only touches the others, or is on another path', ({ expect }) => {
    const fields = [fieldOn('src/a.ts', [3, 5])];
    for (const added of [
      fieldOn('src/a.ts', [6, 6]),
      fieldOn('src/a.ts', [3, 2]),
      fieldOn('src/a.ts', [6, 5]),
      fieldOn('src/b.ts', [3, 5]),
    ]) {
      expect(withSuggestionField(fields, added)).toStrictEqual({
        kind: 'added',
        fields: [...fields, added],
      });
    }
  });

  test('names the field a new one would overlap', ({ expect }) => {
    const existing = fieldOn('src/a.ts', [3, 5]);
    for (const added of [
      fieldOn('src/a.ts', [5, 7]),
      fieldOn('src/a.ts', [1, 3]),
      fieldOn('src/a.ts', [4, 3]),
    ]) {
      expect(withSuggestionField([existing], added)).toStrictEqual({
        kind: 'overlaps',
        field: existing,
      });
    }
    const insertion = fieldOn('src/a.ts', [4, 3]);
    expect(withSuggestionField([insertion], fieldOn('src/a.ts', [4, 3]))).toStrictEqual({
      kind: 'overlaps',
      field: insertion,
    });
  });
});
