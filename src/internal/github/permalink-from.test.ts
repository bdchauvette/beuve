import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { permalinkFrom } from './permalink-from.ts';
import type { PermalinkTarget } from './permalink-from.ts';

function repositoryAt(sha: string): Pick<PermalinkTarget, 'host' | 'owner' | 'repo' | 'sha'> {
  return { host: 'github.com', owner: 'octo', repo: 'beuve', sha };
}

describe('permalinkFrom', () => {
  test('links a line range, a single line and a whole file', ({ expect }) => {
    const sha = 'a'.repeat(40);
    const repository = repositoryAt(sha);
    const base = `https://github.com/octo/beuve/blob/${sha}/src/a.ts`;
    expect(permalinkFrom({ ...repository, path: 'src/a.ts', startLine: 3, endLine: 9 })).toBe(
      `${base}#L3-L9`,
    );
    expect(permalinkFrom({ ...repository, path: 'src/a.ts', startLine: 3, endLine: 3 })).toBe(
      `${base}#L3`,
    );
    expect(permalinkFrom({ ...repository, path: 'src/a.ts', startLine: 3 })).toBe(`${base}#L3`);
    expect(permalinkFrom({ ...repository, path: 'src/a.ts' })).toBe(base);
  });

  test('links lines of a rendered file in its plain view, the whole file rendered', ({
    expect,
  }) => {
    const sha = 'a'.repeat(40);
    const repository = repositoryAt(sha);
    const base = `https://github.com/octo/beuve/blob/${sha}/docs/Guide.MD`;
    expect(permalinkFrom({ ...repository, path: 'docs/Guide.MD', startLine: 2, endLine: 4 })).toBe(
      `${base}?plain=1#L2-L4`,
    );
    expect(permalinkFrom({ ...repository, path: 'docs/Guide.MD' })).toBe(base);
  });

  test('encodes each path segment on its own', ({ expect }) => {
    const sha = 'a'.repeat(40);
    const repository = repositoryAt(sha);
    expect(permalinkFrom({ ...repository, path: 'docs/a b/#1?.md', startLine: 1 })).toBe(
      `https://github.com/octo/beuve/blob/${sha}/docs/a%20b/%231%3F.md?plain=1#L1`,
    );
    expect(permalinkFrom({ ...repository, path: 'src/ü.ts' })).toBe(
      `https://github.com/octo/beuve/blob/${sha}/src/%C3%BC.ts`,
    );
  });

  test('links to a GitHub Enterprise Server on its own host', ({ expect }) => {
    const sha = 'a'.repeat(40);
    const repository = repositoryAt(sha);
    expect(
      permalinkFrom({
        ...repository,
        host: 'GHE.Example.com',
        path: 'README.md',
        startLine: 2,
        endLine: 4,
      }),
    ).toBe(`https://ghe.example.com/octo/beuve/blob/${sha}/README.md?plain=1#L2-L4`);
  });
});
