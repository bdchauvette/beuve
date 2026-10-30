import { describe } from 'vitest';

import { describeToolUse } from './describe-tool-use.ts';
import { test } from './testing/test.ts';

describe('describeToolUse', () => {
  test.for([
    ['Read', { file_path: '/work/src/auth.ts', offset: 1, limit: 40 }, 'read src/auth.ts:1-40'],
    ['Read', { file_path: '/work/a.ts' }, 'read a.ts'],
    ['Read', { file_path: '/elsewhere/a.ts' }, 'read /elsewhere/a.ts'],
    ['Grep', { pattern: 'validate(' }, 'grep validate('],
    ['Grep', { pattern: 'x', path: '/work/src' }, 'grep x in src'],
    ['Glob', { pattern: '**/*.test.ts' }, 'glob **/*.test.ts'],
    ['read_file', { path: 'src/a.ts', start_line: 3, end_line: 9 }, 'read src/a.ts:3-9'],
    ['StructuredOutput', { value: 'secret' }, 'StructuredOutput'],
    ['Read', 'not an object', 'read'],
  ] as const)('%s %o is %s', ([tool, input, expected], { expect }) => {
    expect(describeToolUse(tool, input, '/work')).toBe(expected);
  });

  test('keeps one short line', ({ expect }) => {
    const description = describeToolUse('Grep', { pattern: `a\n${'b'.repeat(200)}` }, '/work');
    expect(description).toHaveLength(80);
    expect(description).not.toContain('\n');
  });
});
