import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseLinkHeader } from './parse-link-header.ts';

describe('parseLinkHeader', () => {
  test('reads GitHub pagination links', ({ expect }) => {
    const links = parseLinkHeader(
      '<https://api.github.com/repositories/1/pulls?page=2>; rel="next", <https://api.github.com/repositories/1/pulls?page=5>; rel="last"',
    );
    expect(links.get('next')).toBe('https://api.github.com/repositories/1/pulls?page=2');
    expect(links.get('last')).toBe('https://api.github.com/repositories/1/pulls?page=5');
    expect(links.get('prev')).toBeUndefined();
  });

  test('handles absent, empty and multi-relation headers', ({ expect }) => {
    expect(parseLinkHeader().size).toBe(0);
    expect(parseLinkHeader('').size).toBe(0);
    expect(parseLinkHeader('<https://x/a>; rel="prev first"').get('first')).toBe('https://x/a');
    expect(parseLinkHeader('<https://x/a>; title="no rel"').size).toBe(0);
  });
});
