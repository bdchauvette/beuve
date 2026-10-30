import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { acceleratorsFor } from './accelerators-for.ts';
import type { CatalogCommand } from './command-catalog.ts';

describe('acceleratorsFor', () => {
  test('puts the platform’s primary key before its alternates', ({ expect }) => {
    const command: CatalogCommand = {
      id: 'next-hunk',
      title: 'Next Change',
      keys: { mac: 'Cmd+Down', linux: 'Alt+Down', macAlt: ['F7'], linuxAlt: ['F7'] },
      windows: ['main'],
      handler: 'window',
    };
    expect(acceleratorsFor(command, 'mac')).toStrictEqual(['Cmd+Down', 'F7']);
    expect(acceleratorsFor(command, 'linux')).toStrictEqual(['Alt+Down', 'F7']);
  });

  test('answers nothing without keys, and alternates without a primary', ({ expect }) => {
    const bare: CatalogCommand = { id: 'x', title: 'X', windows: ['main'], handler: 'window' };
    expect(acceleratorsFor(bare, 'mac')).toStrictEqual([]);
    expect(
      acceleratorsFor({ ...bare, keys: { mac: 'Cmd+E', linuxAlt: ['F3'] } }, 'linux'),
    ).toStrictEqual(['F3']);
  });
});
