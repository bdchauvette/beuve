import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseLanguageServersConfig } from './parse-language-servers-config.ts';

describe('parseLanguageServersConfig', () => {
  test('reads servers and overrides', ({ expect }) => {
    const text = JSON.stringify({
      servers: {
        gopls: { args: ['serve'], rootMarkers: ['go.mod'], inheritEnv: ['GOPATH'] },
        ruff: { command: 'ruff', args: ['server'], extensions: { '.py': 'python' } },
      },
      overrides: [
        { match: { path: '~/work/**' }, servers: { gopls: { env: { GOFLAGS: '-mod=mod' } } } },
        { match: { remote: 'github.com/octo/*' }, servers: { ruff: { enabled: false } } },
      ],
    });
    expect(parseLanguageServersConfig(text)).toMatchObject({
      ok: true,
      value: { servers: { gopls: { args: ['serve'] } }, overrides: [{}, {}] },
    });
  });

  test('accepts an empty file and a bare object', ({ expect }) => {
    expect(parseLanguageServersConfig('{}')).toStrictEqual({ ok: true, value: {} });
  });

  test('says when it is not JSON', ({ expect }) => {
    expect(parseLanguageServersConfig('{ servers: ')).toStrictEqual({
      ok: false,
      error: 'it is not valid JSON',
    });
  });

  test('refuses what it does not know, naming where', ({ expect }) => {
    const unknownKey = parseLanguageServersConfig('{"servers":{"go":{"cmd":"gopls"}}}');
    expect(unknownKey).toMatchObject({ ok: false });
    expect(JSON.stringify(unknownKey)).toContain('cmd');
    const badType = parseLanguageServersConfig('{"servers":{"go":{"args":"serve"}}}');
    expect(JSON.stringify(badType)).toContain('args');
    const badId = parseLanguageServersConfig('{"servers":{"Go!":{}}}');
    expect(badId).toMatchObject({ ok: false });
    const badMatch = parseLanguageServersConfig(
      '{"overrides":[{"match":{"path":"a","remote":"b"},"servers":{}}]}',
    );
    expect(badMatch).toMatchObject({ ok: false });
  });

  test('refuses a marker that is a path, a source it does not offer, and control characters', ({
    expect,
  }) => {
    expect(
      parseLanguageServersConfig('{"servers":{"go":{"rootMarkers":["a/go.mod"]}}}'),
    ).toMatchObject({
      ok: false,
    });
    expect(parseLanguageServersConfig('{"servers":{"go":{"source":"builtin"}}}')).toMatchObject({
      ok: false,
    });
    expect(
      parseLanguageServersConfig('{"servers":{"go":{"command":"gopls\\u0000"}}}'),
    ).toMatchObject({ ok: false });
  });
});
