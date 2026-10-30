import { describe } from 'vitest';

import { createSyntaxParser } from './create-syntax-parser.ts';
import { extractModuleReferences } from './extract-module-references.ts';
import { test } from './testing/test.ts';

describe('extractModuleReferences', () => {
  test('finds every way TypeScript refers to a module, in source order', async ({ expect }) => {
    const found = await referencesIn(
      'a.ts',
      [
        "import a from './a.ts';",
        'import type { B } from "#x/b.ts";',
        "import './side';",
        "import x = require('./req');",
        "export * from './star';",
        "export { c } from './c';",
        "export type { D } from './d';",
        "const m = await import('./dyn');",
        "const r = require('./r');",
        'export const local = 1;',
      ].join('\n'),
    );
    expect(found).toStrictEqual([
      ['./a.ts', 'static', false],
      ['#x/b.ts', 'static', true],
      ['./side', 'static', false],
      ['./req', 'require', false],
      ['./star', 'export-from', false],
      ['./c', 'export-from', false],
      ['./d', 'export-from', true],
      ['./dyn', 'dynamic', false],
      ['./r', 'require', false],
    ]);
  });

  test('finds imports nested in functions and in TSX and JavaScript', async ({ expect }) => {
    const tsx = await referencesIn(
      'a.tsx',
      "import React from 'react';\nfunction f() { return import('./lazy'); }\nconst v = <div />;",
    );
    const javascript = await referencesIn(
      'a.mjs',
      "import fs from 'node:fs';\nrequire('./b.cjs');",
    );
    expect(tsx).toStrictEqual([
      ['react', 'static', false],
      ['./lazy', 'dynamic', false],
    ]);
    expect(javascript).toStrictEqual([
      ['node:fs', 'static', false],
      ['./b.cjs', 'require', false],
    ]);
  });

  test('skips computed specifiers, empty ones and other calls named like imports', async ({
    expect,
  }) => {
    const found = await referencesIn(
      'a.ts',
      "const n = './x';\nimport(n);\nrequire(`./t`);\nrequire('');\nobj.require('./no');\nload('./no');",
    );
    expect(found).toStrictEqual([]);
  });
});

async function referencesIn(
  path: string,
  source: string,
): Promise<readonly (readonly [string, string, boolean])[]> {
  const parsed = await createSyntaxParser().parse(path, source, (root) =>
    extractModuleReferences(root).map(
      ({ specifier, kind, isTypeOnly }) => [specifier, kind, isTypeOnly] as const,
    ),
  );
  return parsed.ok ? parsed.value : [];
}
