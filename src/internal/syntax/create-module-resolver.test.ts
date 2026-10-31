import { describe } from 'vitest';

import { createModuleResolver } from './create-module-resolver.ts';
import type { ModuleResolver } from './create-module-resolver.ts';
import { test } from './testing/test.ts';

describe('createModuleResolver', () => {
  test('resolves relative specifiers, probing extensions, emitted extensions and index files', ({
    expect,
  }) => {
    const resolve = resolver(
      ['src/a.ts', 'src/util/b.ts', 'src/util/index.ts', 'src/c.tsx', 'src/data.json', 'lib/d.js'],
      {},
    );
    expect(resolve({ specifier: './util/b', fromPath: 'src/a.ts' })).toBe('src/util/b.ts');
    expect(resolve({ specifier: './util/b.js', fromPath: 'src/a.ts' })).toBe('src/util/b.ts');
    expect(resolve({ specifier: './util', fromPath: 'src/a.ts' })).toBe('src/util/index.ts');
    expect(resolve({ specifier: './c.jsx', fromPath: 'src/a.ts' })).toBe('src/c.tsx');
    expect(resolve({ specifier: './data.json', fromPath: 'src/a.ts' })).toBe('src/data.json');
    expect(resolve({ specifier: '../lib/d', fromPath: 'src/a.ts' })).toBe('lib/d.js');
    expect(resolve({ specifier: './missing', fromPath: 'src/a.ts' })).toBeUndefined();
    expect(resolve({ specifier: '.', fromPath: 'src/util/b.ts' })).toBe('src/util/index.ts');
  });

  test('resolves #aliases through the nearest package.json imports, with patterns', ({
    expect,
  }) => {
    const resolve = resolver(
      [
        'src/x/log/create-logger.ts',
        'src/git/is-commit-sha.ts',
        'src/main/index.ts',
        'src/ui/a.ts',
      ],
      {
        'package.json': JSON.stringify({
          imports: {
            '#x/*': './src/x/*',
            '#git/*': './src/git/*',
            '#exact': './src/main/index.ts',
          },
        }),
      },
    );
    expect(resolve({ specifier: '#x/log/create-logger.ts', fromPath: 'src/main/start.ts' })).toBe(
      'src/x/log/create-logger.ts',
    );
    expect(resolve({ specifier: '#git/is-commit-sha.ts', fromPath: 'src/ui/a.ts' })).toBe(
      'src/git/is-commit-sha.ts',
    );
    expect(resolve({ specifier: '#exact', fromPath: 'src/ui/a.ts' })).toBe('src/main/index.ts');
    expect(resolve({ specifier: '#unknown/x.ts', fromPath: 'src/ui/a.ts' })).toBeUndefined();
  });

  test('picks import conditions and lets a nested package override the root', ({ expect }) => {
    const resolve = resolver(['pkg/src/m.ts', 'src/m.ts', 'pkg/src/z.ts'], {
      'package.json': JSON.stringify({ imports: { '#m': './src/m.ts' } }),
      'pkg/package.json': JSON.stringify({
        imports: { '#m': { node: { import: './src/m.ts' }, default: './src/z.ts' } },
      }),
    });
    expect(resolve({ specifier: '#m', fromPath: 'pkg/src/z.ts' })).toBe('pkg/src/m.ts');
    expect(resolve({ specifier: '#m', fromPath: 'src/m.ts' })).toBe('src/m.ts');
  });

  test('resolves tsconfig paths with baseUrl, comments and trailing commas', ({ expect }) => {
    const resolve = resolver(['app/src/lib/thing.ts', 'app/src/main.ts', 'app/shared/s.ts'], {
      'app/tsconfig.json': `{
        // a comment
        "compilerOptions": {
          "baseUrl": "./src", /* block */
          "paths": { "@lib/*": ["lib/*", "../shared/*"], "@main": ["main"], },
        },
      }`,
    });
    expect(resolve({ specifier: '@lib/thing', fromPath: 'app/src/main.ts' })).toBe(
      'app/src/lib/thing.ts',
    );
    expect(resolve({ specifier: '@lib/s', fromPath: 'app/src/main.ts' })).toBe('app/shared/s.ts');
    expect(resolve({ specifier: '@main', fromPath: 'app/src/lib/thing.ts' })).toBe(
      'app/src/main.ts',
    );
    expect(resolve({ specifier: '@lib/thing', fromPath: 'other/x.ts' })).toBeUndefined();
  });

  test('treats bare packages and malformed config as external', ({ expect }) => {
    const resolve = resolver(['src/a.ts'], {
      'package.json': '{ not json',
      'tsconfig.json': '[]',
    });
    expect(resolve({ specifier: 'react', fromPath: 'src/a.ts' })).toBeUndefined();
    expect(resolve({ specifier: 'node:fs', fromPath: 'src/a.ts' })).toBeUndefined();
    expect(resolve({ specifier: '#x/y.ts', fromPath: 'src/a.ts' })).toBeUndefined();
  });
});

function resolver(paths: readonly string[], configs: Record<string, string>): ModuleResolver {
  return createModuleResolver({
    paths: new Set([...paths, ...Object.keys(configs)]),
    configs: new Map(Object.entries(configs)),
  });
}
