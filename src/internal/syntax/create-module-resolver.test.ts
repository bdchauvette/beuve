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
    expect(resolve('./util/b', 'src/a.ts')).toBe('src/util/b.ts');
    expect(resolve('./util/b.js', 'src/a.ts')).toBe('src/util/b.ts');
    expect(resolve('./util', 'src/a.ts')).toBe('src/util/index.ts');
    expect(resolve('./c.jsx', 'src/a.ts')).toBe('src/c.tsx');
    expect(resolve('./data.json', 'src/a.ts')).toBe('src/data.json');
    expect(resolve('../lib/d', 'src/a.ts')).toBe('lib/d.js');
    expect(resolve('./missing', 'src/a.ts')).toBeUndefined();
    expect(resolve('.', 'src/util/b.ts')).toBe('src/util/index.ts');
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
    expect(resolve('#x/log/create-logger.ts', 'src/main/start.ts')).toBe(
      'src/x/log/create-logger.ts',
    );
    expect(resolve('#git/is-commit-sha.ts', 'src/ui/a.ts')).toBe('src/git/is-commit-sha.ts');
    expect(resolve('#exact', 'src/ui/a.ts')).toBe('src/main/index.ts');
    expect(resolve('#unknown/x.ts', 'src/ui/a.ts')).toBeUndefined();
  });

  test('picks import conditions and lets a nested package override the root', ({ expect }) => {
    const resolve = resolver(['pkg/src/m.ts', 'src/m.ts', 'pkg/src/z.ts'], {
      'package.json': JSON.stringify({ imports: { '#m': './src/m.ts' } }),
      'pkg/package.json': JSON.stringify({
        imports: { '#m': { node: { import: './src/m.ts' }, default: './src/z.ts' } },
      }),
    });
    expect(resolve('#m', 'pkg/src/z.ts')).toBe('pkg/src/m.ts');
    expect(resolve('#m', 'src/m.ts')).toBe('src/m.ts');
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
    expect(resolve('@lib/thing', 'app/src/main.ts')).toBe('app/src/lib/thing.ts');
    expect(resolve('@lib/s', 'app/src/main.ts')).toBe('app/shared/s.ts');
    expect(resolve('@main', 'app/src/lib/thing.ts')).toBe('app/src/main.ts');
    expect(resolve('@lib/thing', 'other/x.ts')).toBeUndefined();
  });

  test('treats bare packages and malformed config as external', ({ expect }) => {
    const resolve = resolver(['src/a.ts'], {
      'package.json': '{ not json',
      'tsconfig.json': '[]',
    });
    expect(resolve('react', 'src/a.ts')).toBeUndefined();
    expect(resolve('node:fs', 'src/a.ts')).toBeUndefined();
    expect(resolve('#x/y.ts', 'src/a.ts')).toBeUndefined();
  });
});

function resolver(paths: readonly string[], configs: Record<string, string>): ModuleResolver {
  return createModuleResolver({
    paths: new Set([...paths, ...Object.keys(configs)]),
    configs: new Map(Object.entries(configs)),
  });
}
