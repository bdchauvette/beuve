import { describe } from 'vitest';

import type { ServerTrustDecision, ServerTrustRequest } from '#internal/lsp/check-server-trust.ts';
import { test } from '#testing/test.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';

import { createShellEnvironments } from './create-shell-environments.ts';
import type { ShellEnvironmentsOptions } from './create-shell-environments.ts';
import type {
  ReadShellEnvironment,
  ReadShellEnvironmentOptions,
} from './read-shell-environment.ts';

/** A reader that answers from a table of directory → result, and remembers what it was asked. */
interface FakeReader {
  readonly read: ReadShellEnvironment;
  readonly asked: ReadShellEnvironmentOptions[];
}

function createFakeReader(
  answers: Readonly<Record<string, Record<string, string> | 'fails'>>,
): FakeReader {
  const asked: ReadShellEnvironmentOptions[] = [];
  const read: ReadShellEnvironment = async (options) => {
    await Promise.resolve();
    asked.push(options);
    const answer = answers[options.cwd];
    if (answer === undefined || answer === 'fails') {
      return err({ kind: 'failed', code: 1, stderr: 'rc file broke' });
    }
    return ok(answer);
  };
  return { read, asked };
}

type Overrides = Partial<ShellEnvironmentsOptions>;

function options(
  reader: FakeReader,
  logger: ShellEnvironmentsOptions['logger'],
  overrides: Overrides = {},
): ShellEnvironmentsOptions {
  return {
    processEnvironment: { PATH: '/usr/bin' },
    shell: '/bin/zsh',
    nodeCommand: '/opt/node/bin/node',
    home: '/home/me',
    shouldRead: true,
    read: reader.read,
    trust: (): ServerTrustDecision => {
      return { allowed: true };
    },
    logger,
    ...overrides,
  };
}

describe('createShellEnvironments', () => {
  test('reads the base once from the home directory and uses it for a checkout with no environment of its own', async ({
    expect,
    logger,
  }) => {
    const reader = createFakeReader({
      '/home/me': { PATH: '/opt/go/bin:/usr/bin' },
      '/checkout': 'fails',
    });
    const environments = createShellEnvironments(options(reader, logger.logger));
    const first = await environments.forRoot('/checkout');
    expect(first.variables).toStrictEqual({ PATH: '/opt/go/bin:/usr/bin' });
    expect(first.notice).toContain('could not be read');
    expect(reader.asked.map(({ cwd }) => cwd)).toStrictEqual(['/home/me', '/checkout']);
  });

  test('reads a checkout in its own directory, once, and the result replaces the base', async ({
    expect,
    logger,
  }) => {
    const reader = createFakeReader({
      '/home/me': { PATH: '/usr/bin' },
      '/checkout': { PATH: '/checkout/.direnv/bin:/usr/bin', GOFLAGS: '-mod=mod' },
    });
    const environments = createShellEnvironments(options(reader, logger.logger));
    const [one, two] = await Promise.all([
      environments.forRoot('/checkout'),
      environments.forRoot('/checkout'),
    ]);
    expect(one).toStrictEqual({
      variables: { PATH: '/checkout/.direnv/bin:/usr/bin', GOFLAGS: '-mod=mod' },
    });
    expect(two).toBe(one);
    expect(reader.asked.filter(({ cwd }) => cwd === '/checkout')).toHaveLength(1);
    expect(environments.noticeFor('/checkout')).toBeUndefined();
  });

  test('asks the shell again for a checkout after it was forgotten', async ({ expect, logger }) => {
    const reader = createFakeReader({
      '/home/me': { PATH: '/usr/bin' },
      '/checkout': { PATH: '/checkout/bin' },
    });
    const environments = createShellEnvironments(options(reader, logger.logger));
    await environments.forRoot('/checkout');
    environments.forget('/checkout');
    await environments.forRoot('/checkout');
    expect(reader.asked.filter(({ cwd }) => cwd === '/checkout')).toHaveLength(2);
    expect(reader.asked.filter(({ cwd }) => cwd === '/home/me')).toHaveLength(1);
  });

  test('keeps the base environment, and says why, when the checkout shell fails', async ({
    expect,
    logger,
  }) => {
    const reader = createFakeReader({ '/home/me': { PATH: '/opt/go/bin' }, '/checkout': 'fails' });
    const environments = createShellEnvironments(options(reader, logger.logger));
    const environment = await environments.forRoot('/checkout');
    expect(environment.variables).toStrictEqual({ PATH: '/opt/go/bin' });
    expect(environment.notice).toContain('direnv or mise');
    expect(environments.noticeFor('/checkout')).toBe(environment.notice);
    expect(logger.lines.some((line) => line['level'] === 'warn')).toBe(true);
  });

  test('asks no shell for a checkout the trust check refuses', async ({ expect, logger }) => {
    const reader = createFakeReader({ '/home/me': { PATH: '/opt/go/bin' } });
    const asked: ServerTrustRequest[] = [];
    const environments = createShellEnvironments(
      options(reader, logger.logger, {
        trust: (request) => {
          asked.push(request);
          return { allowed: false, reason: 'not trusted here' };
        },
      }),
    );
    const environment = await environments.forRoot('/checkout');
    expect(asked).toStrictEqual([{ kind: 'checkout-environment', root: '/checkout' }]);
    expect(environment).toStrictEqual({
      variables: { PATH: '/opt/go/bin' },
      notice: 'not trusted here',
    });
    expect(reader.asked.map(({ cwd }) => cwd)).toStrictEqual(['/home/me']);
  });

  test('reads nothing when the environment is already complete', async ({ expect, logger }) => {
    const reader = createFakeReader({});
    const environments = createShellEnvironments(
      options(reader, logger.logger, { shouldRead: false }),
    );
    const environment = await environments.forRoot('/checkout');
    expect(environment).toStrictEqual({ variables: { PATH: '/usr/bin' } });
    expect(reader.asked).toStrictEqual([]);
  });

  test('says so, and asks nothing, with no shell or no node to ask with', async ({
    expect,
    logger,
  }) => {
    const reader = createFakeReader({});
    const noShell = createShellEnvironments(options(reader, logger.logger, { shell: undefined }));
    const noNode = createShellEnvironments(
      options(reader, logger.logger, { nodeCommand: undefined }),
    );
    const withoutShell = await noShell.forRoot('/checkout');
    const withoutNode = await noNode.forRoot('/checkout');
    expect(withoutShell.notice).toContain('could not be read');
    expect(withoutNode.notice).toContain('could not be read');
    expect(reader.asked).toStrictEqual([]);
  });
});
