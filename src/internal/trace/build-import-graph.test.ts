import { describe, expect, it } from 'vitest';

import { buildImportGraph } from './build-import-graph.ts';

describe('buildImportGraph', () => {
  it('resolves relative specifiers the way TypeScript projects write them', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c/index.tsx', 'src/d.js', 'src/e.mts', 'src/f.ts'];
    const source = [
      "import { b } from './b.js';",
      "import type { C } from './c';",
      "export * from './d.js';",
      "import './e.mjs';",
      "const f = await import('./f');",
      "vi.mock('./b.ts');",
      "import { lit } from 'lit';",
      "import x from '#pkg/x.ts';",
      "import missing from './missing';",
    ].join('\n');
    expect(buildImportGraph(new Map([['src/a.ts', source]]), files)).toEqual(
      new Map([['src/a.ts', ['src/b.ts', 'src/c/index.tsx', 'src/d.js', 'src/e.mts', 'src/f.ts']]]),
    );
  });

  it('follows parent directories and multi-line imports', () => {
    const source = "import {\n  one,\n  two,\n} from '../lib/util';\n";
    expect(
      buildImportGraph(new Map([['src/x/y.test.ts', source]]), ['src/lib/util.ts']).get(
        'src/x/y.test.ts',
      ),
    ).toEqual(['src/lib/util.ts']);
  });
});
