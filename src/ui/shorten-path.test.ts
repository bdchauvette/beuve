import { describe, expect, it } from 'vitest';

import { shortenPath } from './shorten-path.ts';

describe('shortenPath', () => {
  it('keeps the last two segments', () => {
    expect(shortenPath('/home/me/code/notes')).toBe('…/code/notes');
    expect(shortenPath('/code/notes')).toBe('/code/notes');
  });
});
