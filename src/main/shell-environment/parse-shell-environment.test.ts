import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseShellEnvironment } from './parse-shell-environment.ts';

describe('parseShellEnvironment', () => {
  test('reads the variables between the markers, past a banner and trailing output', ({
    expect,
  }) => {
    const output =
      'Welcome back!\nM4RK{"PATH":"/opt/go/bin:/usr/bin","GOPATH":"/home/me/go"}M4RK\nbye\n';
    expect(parseShellEnvironment({ output, marker: 'M4RK' })).toStrictEqual({
      ok: true,
      value: { PATH: '/opt/go/bin:/usr/bin', GOPATH: '/home/me/go' },
    });
  });

  test('drops values that are not strings', ({ expect }) => {
    const output = 'M4RK{"A":"1","B":2,"C":null,"D":{"x":1}}M4RK';
    expect(parseShellEnvironment({ output, marker: 'M4RK' })).toStrictEqual({
      ok: true,
      value: { A: '1' },
    });
  });

  test('says so when the markers, the JSON or its shape are missing', ({ expect }) => {
    for (const output of [
      '',
      'no markers here',
      'M4RK{"A":"1"}',
      'M4RK{nope}M4RK',
      'M4RK[1,2]M4RK',
    ]) {
      expect(parseShellEnvironment({ output, marker: 'M4RK' })).toMatchObject({
        ok: false,
        error: { kind: 'unreadable' },
      });
    }
  });
});
