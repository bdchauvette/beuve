import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { findModuleSpecifier } from './find-module-specifier.ts';

function found(line: string, character: number): string | undefined {
  return findModuleSpecifier(line, character)?.text;
}

describe('findModuleSpecifier', () => {
  test('finds the path between the quotes of each import form', ({ expect }) => {
    expect(found("import { validate } from './auth';", 28)).toBe('./auth');
    expect(found("import './polyfill';", 10)).toBe('./polyfill');
    expect(found('export * from "../lib/index.ts";', 20)).toBe('../lib/index.ts');
    expect(found("const m = await import('./lazy');", 26)).toBe('./lazy');
    expect(found("const fs = require('node:fs');", 24)).toBe('node:fs');
  });

  test('reports the columns of the path alone, not its quotes', ({ expect }) => {
    const line = "import { a } from './auth';";
    expect(findModuleSpecifier(line, 22)).toStrictEqual({ start: 19, end: 25, text: './auth' });
    expect(findModuleSpecifier(line, 18)).toBeUndefined();
    expect(findModuleSpecifier(line, 25)).toBeUndefined();
  });

  test('ignores other strings and names on the line', ({ expect }) => {
    expect(findModuleSpecifier("log('./auth', value);", 6)).toBeUndefined();
    expect(findModuleSpecifier("import { a } from './auth';", 9)).toBeUndefined();
    expect(findModuleSpecifier('', 0)).toBeUndefined();
  });
});
