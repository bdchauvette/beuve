import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { inspect } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { createGhCliCredentialProvider } from './create-gh-cli-credential-provider.ts';
import type { GithubCredentialProvider } from './github-credential-provider.ts';
import { writeFakeGh } from './testing/write-fake-gh.ts';
import type { FakeGhScenario } from './testing/write-fake-gh.ts';

const temporary = mkdtempSync(path.join(tmpdir(), 'beuve-fake-gh-'));
const directory = realpathSync(temporary);
const script = writeFakeGh(directory);
const scenarios = { count: 0 };

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

interface Fixture {
  readonly provider: GithubCredentialProvider;
  readonly calls: () => readonly { args: string[]; envKeys: string[]; cwd: string }[];
}

function fake(scenario: Omit<FakeGhScenario, 'callsFile'>, timeoutMs = 5000): Fixture {
  scenarios.count += 1;
  const file = path.join(directory, `scenario-${String(scenarios.count)}.json`);
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
    timeoutMs,
  });
  const calls = (): { args: string[]; envKeys: string[]; cwd: string }[] =>
    readFileSync(callsFile, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { args: string[]; envKeys: string[]; cwd: string });
  return { provider, calls };
}

const loggedIn = {
  hosts: { 'github.com': { token: 'gho_abcdefghijklmnopqrstuvwxyz0123', login: 'octocat' } },
};

describe('createGhCliCredentialProvider', () => {
  it('returns the token gh prints, redacted everywhere but reveal()', async () => {
    const { provider, calls } = fake(loggedIn);
    const result = await provider.getToken({ host: 'GitHub.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const token = result.value;
    expect(token.reveal()).toBe('gho_abcdefghijklmnopqrstuvwxyz0123');
    expect(String(token)).toBe('[redacted]');
    expect([token].join('')).toBe('[redacted]');
    expect(JSON.stringify({ token })).toBe('{"token":"[redacted]"}');
    expect(inspect({ token })).not.toContain('gho_');

    const [call] = calls();
    expect(call?.args).toEqual(['auth', 'token', '--hostname', 'github.com']);
    expect(call?.cwd).toBe(directory);
    expect(call?.envKeys).toContain('GH_CONFIG_DIR');
    expect(call?.envKeys).toContain('GH_PROMPT_DISABLED');
    expect(call?.envKeys).not.toContain('GH_TOKEN');
    expect(call?.envKeys).not.toContain('GITHUB_TOKEN');
    expect(call?.envKeys).not.toContain('NODE_OPTIONS');
  });

  it('reports not-logged-in for github.com', async () => {
    const { provider } = fake({ hosts: {} });
    await expect(provider.getToken({ host: 'github.com' })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'not-logged-in',
        host: 'github.com',
        remedy: 'gh auth login --hostname github.com',
      },
    });
  });

  it('reports host-not-configured for an Enterprise host gh has no login for', async () => {
    const { provider, calls } = fake(loggedIn);
    await expect(provider.getToken({ host: 'ghe.example.com' })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'host-not-configured',
        host: 'ghe.example.com',
        remedy: 'gh auth login --hostname ghe.example.com',
      },
    });
    expect(calls()[0]?.args).toEqual(['auth', 'token', '--hostname', 'ghe.example.com']);
  });

  it('times out a gh that hangs', async () => {
    const { provider } = fake({ hosts: {}, hang: true }, 300);
    await expect(provider.getToken({ host: 'github.com' })).resolves.toEqual({
      ok: false,
      error: { kind: 'timeout', timeoutMs: 300 },
    });
  });

  it('keeps the last stderr line of other failures, with tokens redacted', async () => {
    const { provider } = fake({
      hosts: {},
      fail: 'failed to read keyring entry gho_abcdefghijklmnopqrstuvwxyz0123',
    });
    await expect(provider.getToken({ host: 'github.com' })).resolves.toEqual({
      ok: false,
      error: {
        kind: 'command-failed',
        exitCode: 1,
        message: 'failed to read keyring entry [redacted]',
      },
    });
  });

  it('refuses hosts that could be mistaken for flags or URLs, without running gh', async () => {
    const { provider, calls } = fake(loggedIn);
    for (const host of ['--help', 'https://github.com', 'github.com/x', '']) {
      await expect(provider.getToken({ host })).resolves.toEqual({
        ok: false,
        error: { kind: 'invalid-host', host },
      });
    }
    expect(calls()).toEqual([]);
  });

  it('reports cli-not-installed when the command is missing', async () => {
    const provider = createGhCliCredentialProvider({
      command: path.join(directory, 'no-such-gh'),
      cwd: directory,
    });
    await expect(provider.getToken({ host: 'github.com' })).resolves.toEqual({
      ok: false,
      error: { kind: 'cli-not-installed', searched: [path.join(directory, 'no-such-gh')] },
    });
  });

  it('describes the active account from auth status --json', async () => {
    const { provider, calls } = fake(loggedIn);
    await expect(provider.describe({ host: 'github.com' })).resolves.toEqual({
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
    expect(calls()[0]?.args).toEqual([
      'auth',
      'status',
      '--hostname',
      'github.com',
      '--json',
      'hosts',
    ]);
  });

  it('describes without account details on a gh that has no --json', async () => {
    const { provider } = fake({ ...loggedIn, withoutStatusJson: true });
    await expect(provider.describe({ host: 'github.com' })).resolves.toEqual({
      ok: true,
      value: { provider: 'gh-cli', host: 'github.com', account: undefined },
    });
  });

  it('describes a host without a login as an error', async () => {
    const { provider } = fake(loggedIn);
    const result = await provider.describe({ host: 'ghe.example.com' });
    expect(result).toMatchObject({ ok: false, error: { kind: 'host-not-configured' } });
  });
});
