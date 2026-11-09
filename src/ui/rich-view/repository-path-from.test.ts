import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { repositoryPathFrom } from './repository-path-from.ts';

describe('repositoryPathFrom', () => {
  test.for<[string, string, string | undefined]>([
    ['docs/guide.md', 'setup.md', 'docs/setup.md'],
    ['docs/guide.md', './img/a%20b.png', 'docs/img/a b.png'],
    ['docs/guide.md', '../README.md', 'README.md'],
    ['docs/guide.md', '/src/index.ts', 'src/index.ts'],
    ['README.md', '../outside.md', undefined],
    ['docs/guide.md', '..', undefined],
    ['docs/guide.md', 'bad%E0%A4%A', undefined],
    ['docs/guide.md', 'dir/', 'docs/dir'],
  ])('%s + %s', ([file, reference, expected], { expect }) => {
    expect(repositoryPathFrom({ file, reference })).toBe(expected);
  });
});
