import { describe } from 'vitest';

import { parseCheckAttr } from './parse-check-attr.ts';
import { test } from './testing/test.ts';

function output(...rows: (readonly [string, string, string])[]): string {
  return rows.map((row) => `${row.join('\0')}\0`).join('');
}

describe('parseCheckAttr', () => {
  test('reads linguist-generated set, true, unset and false', ({ expect }) => {
    const parsed = parseCheckAttr(
      output(
        ['a.js', 'linguist-generated', 'set'],
        ['b.js', 'linguist-generated', 'true'],
        ['c.js', 'linguist-generated', 'unset'],
        ['d.js', 'linguist-generated', 'false'],
      ),
    );
    expect(Object.fromEntries(parsed)).toStrictEqual({
      'a.js': { generated: true },
      'b.js': { generated: true },
      'c.js': { generated: false },
      'd.js': { generated: false },
    });
  });

  test('reads -diff and ignores a diff driver or an unspecified attribute', ({ expect }) => {
    const parsed = parseCheckAttr(
      output(
        ['x.bin', 'linguist-generated', 'unspecified'],
        ['x.bin', 'diff', 'unset'],
        ['y.md', 'diff', 'markdown'],
        ['z.ts', 'linguist-generated', 'unspecified'],
        ['z.ts', 'diff', 'unspecified'],
      ),
    );
    expect(Object.fromEntries(parsed)).toStrictEqual({ 'x.bin': { diff: false } });
  });

  test('merges both attributes of one path and keeps odd paths intact', ({ expect }) => {
    const parsed = parseCheckAttr(
      output(['dir/a b\nc.ts', 'linguist-generated', 'set'], ['dir/a b\nc.ts', 'diff', 'unset']),
    );
    expect(parsed.get('dir/a b\nc.ts')).toStrictEqual({ generated: true, diff: false });
  });

  test('reads empty or truncated output as nothing', ({ expect }) => {
    expect(parseCheckAttr('').size).toBe(0);
    expect(parseCheckAttr('a.js\0linguist-generated').size).toBe(0);
  });
});
