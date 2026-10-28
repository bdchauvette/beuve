import { describe, expect, it } from 'vitest';

import { parseDevApiBase } from './parse-dev-api-base.ts';

describe('parseDevApiBase', () => {
  it('accepts loopback http(s) roots and adds the trailing slash', () => {
    expect(parseDevApiBase('http://127.0.0.1:4010')?.href).toBe('http://127.0.0.1:4010/');
    expect(parseDevApiBase('http://localhost:4010/api/v3')?.href).toBe(
      'http://localhost:4010/api/v3/',
    );
  });

  it.each([
    undefined,
    '',
    'https://api.github.com/',
    'http://10.0.0.1:4010/',
    'http://user:pw@127.0.0.1:4010/',
    'ftp://127.0.0.1/',
    'http://127.0.0.1:4010/?x=1',
  ])('ignores %s', (value) => {
    expect(parseDevApiBase(value)).toBeUndefined();
  });
});
