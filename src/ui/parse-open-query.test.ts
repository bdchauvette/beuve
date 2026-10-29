import { describe, expect, it } from 'vitest';

import { parseOpenQuery } from './parse-open-query.ts';

describe('parseOpenQuery', () => {
  it('recognizes pull request URLs, with trailing pages', () => {
    expect(parseOpenQuery(' https://github.com/octo-org/hello/pull/12/files ')).toEqual({
      kind: 'pull-request',
      ref: 'https://github.com/octo-org/hello/pull/12/files',
      host: 'github.com',
      owner: 'octo-org',
      repo: 'hello',
      number: 12,
    });
  });

  it('recognizes owner/repo#n and host/owner/repo#n', () => {
    expect(parseOpenQuery('octo-org/hello#7')).toMatchObject({ host: 'github.com', number: 7 });
    expect(parseOpenQuery('GHE.example.com/a/b#3')).toMatchObject({
      kind: 'pull-request',
      host: 'ghe.example.com',
      owner: 'a',
      repo: 'b',
    });
  });

  it('treats absolute and home paths as folders', () => {
    expect(parseOpenQuery('/src/beuve')).toEqual({ kind: 'path', path: '/src/beuve' });
    expect(parseOpenQuery('~/code/x')).toEqual({ kind: 'path', path: '~/code/x' });
  });

  it('filters with anything else, and is empty when blank', () => {
    expect(parseOpenQuery('tax')).toEqual({ kind: 'filter', text: 'tax' });
    expect(parseOpenQuery('a/b#0')).toEqual({ kind: 'filter', text: 'a/b#0' });
    expect(parseOpenQuery('  ')).toEqual({ kind: 'empty' });
  });
});
