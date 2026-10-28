import { describe, expect, it } from 'vitest';

import { parseLinkHeader } from './parse-link-header.ts';

describe('parseLinkHeader', () => {
  it('reads GitHub pagination links', () => {
    const links = parseLinkHeader(
      '<https://api.github.com/repositories/1/pulls?page=2>; rel="next", <https://api.github.com/repositories/1/pulls?page=5>; rel="last"',
    );
    expect(links.get('next')).toBe('https://api.github.com/repositories/1/pulls?page=2');
    expect(links.get('last')).toBe('https://api.github.com/repositories/1/pulls?page=5');
    expect(links.get('prev')).toBeUndefined();
  });

  it('handles absent, empty and multi-relation headers', () => {
    expect(parseLinkHeader().size).toBe(0);
    expect(parseLinkHeader('').size).toBe(0);
    expect(parseLinkHeader('<https://x/a>; rel="prev first"').get('first')).toBe('https://x/a');
    expect(parseLinkHeader('<https://x/a>; title="no rel"').size).toBe(0);
  });
});
