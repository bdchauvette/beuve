import { describe } from 'vitest';

import type { DependencyStatusView } from '#contract/ipc-contract.ts';

import { describeDependencyStatus } from './describe-dependency-status.ts';
import { test } from './testing/test.ts';

describe('describeDependencyStatus (ADR 0089, 0090)', () => {
  test('offers trust first, and nothing installs before it', ({ expect }) => {
    expect(describeDependencyStatus(status({ state: 'untrusted' }))).toStrictEqual({
      text: 'Dependencies: not installed: trust this repository to install',
      tone: 'muted',
      title: 'beuve installs dependencies only for repositories you trust.',
      buttons: [{ action: 'trust', label: 'Trust…' }],
    });
  });

  test('asks at the safeguard with the changed files, revealed', ({ expect }) => {
    const line = describeDependencyStatus(
      status({
        state: 'needs-approval',
        inputs: ['package-lock.json', 'x\u{202E}y/package.json'],
      }),
    );
    expect(line.text).toBe('Dependencies: safeguard: this change modifies dependencies');
    expect(line.title).toBe('Changed: package-lock.json, x⟨U+202E⟩y/package.json');
    expect(line.buttons.map((button) => button.action)).toStrictEqual([
      'review-files',
      'install',
      'skip',
    ]);
  });

  test('names the tools while installing, their versions once installed, and why it failed', ({
    expect,
  }) => {
    const tools = [{ tool: 'pnpm', version: '10.2.0' }, { tool: 'uv' }];
    expect(
      describeDependencyStatus(status({ state: 'running', tools, hasLog: true })),
    ).toMatchObject({
      text: 'Dependencies: installing (pnpm, uv)…',
      buttons: [{ action: 'cancel' }, { action: 'view-log' }],
    });
    expect(describeDependencyStatus(status({ state: 'done', tools, hasLog: true }))).toMatchObject({
      text: 'Dependencies: installed',
      title: 'Installed with pnpm 10.2.0, uv.',
      buttons: [{ action: 'view-log' }, { action: 'reinstall' }],
    });
    expect(
      describeDependencyStatus(
        status({ state: 'failed', detail: 'bun not found (for bun).', hasLog: false }),
      ),
    ).toMatchObject({
      text: 'Dependencies: failed: bun not found (for bun).',
      tone: 'danger',
      buttons: [{ action: 'install', label: 'Retry' }],
    });
  });
});

function status(overrides: Partial<DependencyStatusView>): DependencyStatusView {
  return {
    sessionId: 's1',
    headSha: 'a'.repeat(40),
    state: 'not-installed',
    repositoryPath: '/repo',
    tools: [],
    inputs: [],
    hasLog: false,
    ...overrides,
  };
}
