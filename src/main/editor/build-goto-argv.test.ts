import { describe } from 'vitest';

import { buildGotoArgv } from './build-goto-argv.ts';
import { test } from '../testing/test.ts';

describe('buildGotoArgv', () => {
  test('uses --goto with path:line:column for VS Code and Cursor', ({ expect }) => {
    expect(buildGotoArgv('/repo/a.ts', 7, 1)).toStrictEqual(['--goto', '/repo/a.ts:7:1']);
  });
});
