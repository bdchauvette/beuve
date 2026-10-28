import { describe, expect, it } from 'vitest';

import { buildGotoArgv } from './build-goto-argv.ts';

describe('buildGotoArgv', () => {
  it('uses --goto with path:line:column for VS Code and Cursor', () => {
    expect(buildGotoArgv('/repo/a.ts', 7, 1)).toEqual(['--goto', '/repo/a.ts:7:1']);
  });
});
