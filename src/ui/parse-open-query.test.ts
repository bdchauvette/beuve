import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { parseOpenQuery } from './parse-open-query.ts';

describe('parseOpenQuery', () => {
  test('recognizes pull request URLs, with trailing pages', ({ expect }) => {
    expect(parseOpenQuery(' https://github.com/octo-org/hello/pull/12/files ')).toStrictEqual({
      kind: 'pull-request',
      ref: 'https://github.com/octo-org/hello/pull/12/files',
      host: 'github.com',
      owner: 'octo-org',
      repo: 'hello',
      number: 12,
    });
  });

  test('recognizes owner/repo#n and host/owner/repo#n', ({ expect }) => {
    expect(parseOpenQuery('octo-org/hello#7')).toMatchObject({ host: 'github.com', number: 7 });
    expect(parseOpenQuery('GHE.example.com/a/b#3')).toMatchObject({
      kind: 'pull-request',
      host: 'ghe.example.com',
      owner: 'a',
      repo: 'b',
    });
  });

  test('recognizes branches to follow by tree URL or owner/repo:branch (ADR 0112)', ({
    expect,
  }) => {
    expect(parseOpenQuery('https://github.com/octo-org/hello/tree/claude/fix-x')).toStrictEqual({
      kind: 'branch',
      ref: 'https://github.com/octo-org/hello/tree/claude/fix-x',
      host: 'github.com',
      owner: 'octo-org',
      repo: 'hello',
      branch: 'claude/fix-x',
    });
    expect(parseOpenQuery('octo-org/hello:claude/x')).toMatchObject({
      kind: 'branch',
      host: 'github.com',
      branch: 'claude/x',
    });
    expect(parseOpenQuery('GHE.example.com/a/b:main')).toMatchObject({
      kind: 'branch',
      host: 'ghe.example.com',
      owner: 'a',
      repo: 'b',
    });
    expect(parseOpenQuery('https://github.com/o/r/tree/')).toMatchObject({ kind: 'filter' });
    expect(parseOpenQuery('a:b')).toMatchObject({ kind: 'filter' });
  });

  test('treats absolute and home paths as folders', ({ expect }) => {
    expect(parseOpenQuery('/src/beuve')).toStrictEqual({ kind: 'path', path: '/src/beuve' });
    expect(parseOpenQuery('~/code/x')).toStrictEqual({ kind: 'path', path: '~/code/x' });
  });

  test('filters with anything else, and is empty when blank', ({ expect }) => {
    expect(parseOpenQuery('tax')).toStrictEqual({ kind: 'filter', text: 'tax' });
    expect(parseOpenQuery('a/b#0')).toStrictEqual({ kind: 'filter', text: 'a/b#0' });
    expect(parseOpenQuery('  ')).toStrictEqual({ kind: 'empty' });
  });
});
