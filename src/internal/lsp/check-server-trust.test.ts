import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { checkServerTrust } from './check-server-trust.ts';
import type { ServerProgramRequest } from './check-server-trust.ts';

function program(overrides: Partial<ServerProgramRequest>): ServerProgramRequest {
  return {
    kind: 'server-program',
    serverId: 'go',
    source: 'path',
    origin: 'builtin',
    root: '/checkout',
    ...overrides,
  };
}

describe('checkServerTrust', () => {
  test("allows programs that ship with beuve or are found on the reviewer's PATH", ({ expect }) => {
    expect(checkServerTrust(program({ source: 'builtin' }))).toStrictEqual({ allowed: true });
    expect(checkServerTrust(program({ source: 'path' }))).toStrictEqual({ allowed: true });
  });

  test("denies a project program that beuve's own table defines", ({ expect }) => {
    const decision = checkServerTrust(program({ source: 'project', origin: 'builtin' }));
    expect(decision).toMatchObject({ allowed: false });
    expect(JSON.stringify(decision)).toContain('go language server');
  });

  test("allows a project program the reviewer's own configuration defined", ({ expect }) => {
    const decision = checkServerTrust(program({ source: 'project', origin: 'reviewer' }));
    expect(decision).toStrictEqual({ allowed: true });
  });

  test('allows the environment of a checkout, whose tools ask for trust themselves', ({
    expect,
  }) => {
    const decision = checkServerTrust({ kind: 'checkout-environment', root: '/checkout' });
    expect(decision).toStrictEqual({ allowed: true });
  });

  test('fails closed on a source it does not know', ({ expect }) => {
    const unknown = { ...program({}), source: 'downloaded' } as unknown as ServerProgramRequest;
    expect(checkServerTrust(unknown)).toMatchObject({ allowed: false });
  });
});
