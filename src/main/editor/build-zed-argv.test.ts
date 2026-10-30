import { describe } from 'vitest';

import { buildZedArgv } from './build-zed-argv.ts';
import { test } from '../testing/test.ts';

describe('buildZedArgv', () => {
  test('passes path:line:column as one argument, spaces intact', ({ expect }) => {
    expect(buildZedArgv('/repo/my dir/a.ts', 42, 10)).toStrictEqual(['/repo/my dir/a.ts:42:10']);
  });
});
