import { describe, expect, it } from 'vitest';

import { buildZedArgv } from './build-zed-argv.ts';

describe('buildZedArgv', () => {
  it('passes path:line:column as one argument, spaces intact', () => {
    expect(buildZedArgv('/repo/my dir/a.ts', 42, 10)).toEqual(['/repo/my dir/a.ts:42:10']);
  });
});
