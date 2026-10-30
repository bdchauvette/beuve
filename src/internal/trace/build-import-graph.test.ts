import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { buildImportGraph } from './build-import-graph.ts';

describe('buildImportGraph', () => {
  test('resolves relative specifiers the way TypeScript projects write them', ({ expect }) => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c/index.tsx', 'src/d.js', 'src/e.mts', 'src/f.ts'];
    const source = [
      "import { b } from './b.js';",
      "import type { C } from './c';",
      "export * from './d.js';",
      "import './e.mjs';",
      "const f = await import('./f');",
      "vi.mock('./b.ts');",
      "import { lit } from 'lit';",
      "import x from '#x/x.ts';",
      "import missing from './missing';",
    ].join('\n');
    expect(buildImportGraph(new Map([['src/a.ts', source]]), files)).toStrictEqual(
      new Map([['src/a.ts', ['src/b.ts', 'src/c/index.tsx', 'src/d.js', 'src/e.mts', 'src/f.ts']]]),
    );
  });

  test('follows parent directories and multi-line imports', ({ expect }) => {
    const source = "import {\n  one,\n  two,\n} from '../lib/util';\n";
    expect(
      buildImportGraph(new Map([['src/x/y.test.ts', source]]), ['src/lib/util.ts']).get(
        'src/x/y.test.ts',
      ),
    ).toStrictEqual(['src/lib/util.ts']);
  });
});
