import { describe } from 'vitest';

import { toUnpackedPath } from './to-unpacked-path.ts';
import { test } from '../testing/test.ts';

describe('toUnpackedPath', () => {
  test('points a file inside app.asar at app.asar.unpacked', ({ expect }) => {
    expect(
      toUnpackedPath(
        '/Applications/beuve.app/Contents/Resources/app.asar/node_modules/typescript/lib/tsserver.js',
        '/',
      ),
    ).toBe(
      '/Applications/beuve.app/Contents/Resources/app.asar.unpacked/node_modules/typescript/lib/tsserver.js',
    );
  });

  test('leaves paths outside an archive alone', ({ expect }) => {
    expect(toUnpackedPath('/home/me/beuve/node_modules/typescript/lib/tsserver.js', '/')).toBe(
      '/home/me/beuve/node_modules/typescript/lib/tsserver.js',
    );
    expect(toUnpackedPath('/home/me/app.asar.d/tsserver.js', '/')).toBe(
      '/home/me/app.asar.d/tsserver.js',
    );
  });

  test('rewrites only the first archive segment, with the platform separator', ({ expect }) => {
    expect(toUnpackedPath(String.raw`C:\beuve\resources\app.asar\x\app.asar`, '\\')).toBe(
      String.raw`C:\beuve\resources\app.asar.unpacked\x\app.asar`,
    );
  });
});
