import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { inspect } from 'node:util';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import { test } from './testing/test.ts';

import { createGhCliCredentialProvider } from './create-gh-cli-credential-provider.ts';
import type { GithubCredentialProvider } from './github-credential-provider.ts';
import type { FakeGhScenario } from './testing/write-fake-gh.ts';

interface Fixture {
  readonly provider: GithubCredentialProvider;
  readonly calls: () => readonly { args: string[]; envKeys: string[]; cwd: string }[];
}

/** A provider over the fake `gh` running `scenario`; its files live in `directory`. */
function fake(
  script: string,
  directory: string,
  scenario: Omit<FakeGhScenario, 'callsFile'>,
  timeout = Temporal.Duration.from({ seconds: 5 }),
): Fixture {
  const file = path.join(directory, 'scenario.json');
  const callsFile = `${file}.calls`;
  writeFileSync(callsFile, '');
  writeFileSync(file, JSON.stringify({ ...scenario, callsFile }));
  const provider = createGhCliCredentialProvider({
    command: process.execPath,
    leadingArgs: [script, file],
    inheritedEnv: {
      PATH: process.env['PATH'],
      HOME: directory,
      GH_CONFIG_DIR: path.join(directory, 'gh'),
      GH_TOKEN: 'ghp_fromtheshellxxxxxxxxxxxxxxxx',
      GITHUB_TOKEN: 'ghp_fromtheshellxxxxxxxxxxxxxxxx',
      NODE_OPTIONS: '--inspect',
    },
    cwd: directory,
    timeout,
  });
  const calls = (): { args: string[]; envKeys: string[]; cwd: string }[] => {
    return readFileSync(callsFile, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { args: string[]; envKeys: string[]; cwd: string });
  };
  return { provider, calls };
}

function loggedIn(): Omit<FakeGhScenario, 'callsFile'> {
  return {
    hosts: { 'github.com': { token: 'gho_abcdefghijklmnopqrstuvwxyz0123', login: 'octocat' } },
  };
}

describe('createGhCliCredentialProvider', () => {
  test('returns the token gh prints, redacted everywhere but reveal()', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider, calls } = fake(fakeGh, directory, loggedIn());
    const token = okValueFrom(await provider.getToken({ host: 'GitHub.com' }));
    expect(token.reveal()).toBe('gho_abcdefghijklmnopqrstuvwxyz0123');
    expect(String(token)).toBe('[redacted]');
    expect([token].join('')).toBe('[redacted]');
    expect(JSON.stringify({ token })).toBe('{"token":"[redacted]"}');
    expect(inspect({ token })).not.toContain('gho_');

    const [call] = calls();
    expect(call?.args).toStrictEqual(['auth', 'token', '--hostname', 'github.com']);
    expect(call?.cwd).toBe(directory);
    expect(call?.envKeys).toContain('GH_CONFIG_DIR');
    expect(call?.envKeys).toContain('GH_PROMPT_DISABLED');
    expect(call?.envKeys).not.toContain('GH_TOKEN');
    expect(call?.envKeys).not.toContain('GITHUB_TOKEN');
    expect(call?.envKeys).not.toContain('NODE_OPTIONS');
  });

  test('reports not-logged-in for github.com', async ({ expect, fakeGh, tempDir: directory }) => {
    const { provider } = fake(fakeGh, directory, { hosts: {} });
    await expect(provider.getToken({ host: 'github.com' })).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'not-logged-in',
        host: 'github.com',
        remedy: 'gh auth login --hostname github.com',
      },
    });
  });

  test('reports host-not-configured for an Enterprise host gh has no login for', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider, calls } = fake(fakeGh, directory, loggedIn());
    await expect(provider.getToken({ host: 'ghe.example.com' })).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'host-not-configured',
        host: 'ghe.example.com',
        remedy: 'gh auth login --hostname ghe.example.com',
      },
    });
    expect(calls()[0]?.args).toStrictEqual(['auth', 'token', '--hostname', 'ghe.example.com']);
  });

  test('times out a gh that hangs', async ({ expect, fakeGh, tempDir: directory }) => {
    const { provider } = fake(
      fakeGh,
      directory,
      { hosts: {}, hang: true },
      Temporal.Duration.from({ milliseconds: 300 }),
    );
    await expect(provider.getToken({ host: 'github.com' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'timeout', timeout: Temporal.Duration.from({ milliseconds: 300 }) },
    });
  });

  test('keeps the last stderr line of other failures, with tokens redacted', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider } = fake(fakeGh, directory, {
      hosts: {},
      fail: 'failed to read keyring entry gho_abcdefghijklmnopqrstuvwxyz0123',
    });
    await expect(provider.getToken({ host: 'github.com' })).resolves.toStrictEqual({
      ok: false,
      error: {
        kind: 'command-failed',
        exitCode: 1,
        message: 'failed to read keyring entry [redacted]',
      },
    });
  });

  test('refuses hosts that could be mistaken for flags or URLs, without running gh', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider, calls } = fake(fakeGh, directory, loggedIn());
    for (const host of ['--help', 'https://github.com', 'github.com/x', '']) {
      await expect(provider.getToken({ host })).resolves.toStrictEqual({
        ok: false,
        error: { kind: 'invalid-host', host },
      });
    }
    expect(calls()).toStrictEqual([]);
  });

  test('reports cli-not-installed when the command is missing', async ({
    expect,
    tempDir: directory,
  }) => {
    const provider = createGhCliCredentialProvider({
      command: path.join(directory, 'no-such-gh'),
      cwd: directory,
    });
    await expect(provider.getToken({ host: 'github.com' })).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'cli-not-installed', searched: [path.join(directory, 'no-such-gh')] },
    });
  });

  test('describes the active account from auth status --json', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider, calls } = fake(fakeGh, directory, loggedIn());
    await expect(provider.describe({ host: 'github.com' })).resolves.toStrictEqual({
      ok: true,
      value: {
        provider: 'gh-cli',
        host: 'github.com',
        account: {
          login: 'octocat',
          scopes: ['gist', 'read:org', 'repo'],
          check: { kind: 'valid' },
        },
      },
    });
    expect(calls()[0]?.args).toStrictEqual([
      'auth',
      'status',
      '--hostname',
      'github.com',
      '--json',
      'hosts',
    ]);
  });

  test('describes without account details on a gh that has no --json', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider } = fake(fakeGh, directory, { ...loggedIn(), withoutStatusJson: true });
    await expect(provider.describe({ host: 'github.com' })).resolves.toStrictEqual({
      ok: true,
      value: { provider: 'gh-cli', host: 'github.com', account: undefined },
    });
  });

  test('describes a host without a login as an error', async ({
    expect,
    fakeGh,
    tempDir: directory,
  }) => {
    const { provider } = fake(fakeGh, directory, loggedIn());
    const result = await provider.describe({ host: 'ghe.example.com' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'host-not-configured' } });
  });
});
