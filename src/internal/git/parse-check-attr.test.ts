import { describe, expect, it } from 'vitest';

import { parseCheckAttr } from './parse-check-attr.ts';

function output(...rows: (readonly [string, string, string])[]): string {
  return rows.map((row) => `${row.join('\0')}\0`).join('');
}

describe('parseCheckAttr', () => {
  it('reads linguist-generated set, true, unset and false', () => {
    const parsed = parseCheckAttr(
      output(
        ['a.js', 'linguist-generated', 'set'],
        ['b.js', 'linguist-generated', 'true'],
        ['c.js', 'linguist-generated', 'unset'],
        ['d.js', 'linguist-generated', 'false'],
      ),
    );
    expect(Object.fromEntries(parsed)).toEqual({
      'a.js': { generated: true },
      'b.js': { generated: true },
      'c.js': { generated: false },
      'd.js': { generated: false },
    });
  });

  it('reads -diff and ignores a diff driver or an unspecified attribute', () => {
    const parsed = parseCheckAttr(
      output(
        ['x.bin', 'linguist-generated', 'unspecified'],
        ['x.bin', 'diff', 'unset'],
        ['y.md', 'diff', 'markdown'],
        ['z.ts', 'linguist-generated', 'unspecified'],
        ['z.ts', 'diff', 'unspecified'],
      ),
    );
    expect(Object.fromEntries(parsed)).toEqual({ 'x.bin': { diff: false } });
  });

  it('merges both attributes of one path and keeps odd paths intact', () => {
    const parsed = parseCheckAttr(
      output(['dir/a b\nc.ts', 'linguist-generated', 'set'], ['dir/a b\nc.ts', 'diff', 'unset']),
    );
    expect(parsed.get('dir/a b\nc.ts')).toEqual({ generated: true, diff: false });
  });

  it('reads empty or truncated output as nothing', () => {
    expect(parseCheckAttr('').size).toBe(0);
    expect(parseCheckAttr('a.js\0linguist-generated').size).toBe(0);
  });
});
