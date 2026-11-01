import { describe } from 'vitest';

import { deleteDependencyInstall } from './delete-dependency-install.ts';
import { failInterruptedInstalls } from './fail-interrupted-installs.ts';
import { findDependencyInstall } from './find-dependency-install.ts';
import { findInstallDecision } from './find-install-decision.ts';
import { findRepositoryInstallSettings } from './find-repository-install-settings.ts';
import { listToolPaths } from './list-tool-paths.ts';
import { saveDependencyInstall } from './save-dependency-install.ts';
import { saveInstallDecision } from './save-install-decision.ts';
import { saveRepositoryInstallSettings } from './save-repository-install-settings.ts';
import { saveToolPath } from './save-tool-path.ts';
import { test } from './testing/test.ts';

describe('the dependency-install tables (ADR 0089, 0090)', () => {
  test('one install per checkout, replaced, interrupted at startup and forgotten', ({
    expect,
    db,
  }) => {
    const install = {
      checkoutPath: '/wt/repo-1/abc',
      repoPath: '/repo',
      commitSha: 'a'.repeat(40),
      state: 'running',
      tools: [{ tool: 'pnpm', version: '10.0.0' }],
      reason: undefined,
      logTail: '',
      updatedAt: '2026-11-01T00:00:00.000Z',
    } as const;
    saveDependencyInstall(db, install);
    expect(findDependencyInstall(db, install.checkoutPath)).toStrictEqual(install);
    expect(failInterruptedInstalls(db, '2026-11-01T01:00:00.000Z')).toBe(1);
    expect(findDependencyInstall(db, install.checkoutPath)).toMatchObject({
      state: 'failed',
      reason: 'interrupted: beuve quit',
    });
    saveDependencyInstall(db, { ...install, state: 'done', logTail: 'ok' });
    expect(findDependencyInstall(db, install.checkoutPath)).toMatchObject({ state: 'done' });
    deleteDependencyInstall(db, install.checkoutPath);
    expect(findDependencyInstall(db, install.checkoutPath)).toBeUndefined();
  });

  test('a safeguard answer per session head, gone with its session', ({ expect, db }) => {
    const decision = {
      sessionId: 's1',
      headSha: 'b'.repeat(40),
      decision: 'decline',
      inputs: ['package-lock.json'],
      decidedAt: '2026-11-01T00:00:00.000Z',
    } as const;
    saveInstallDecision(db, decision);
    expect(findInstallDecision(db, decision)).toStrictEqual(decision);
    expect(findInstallDecision(db, { sessionId: 's2', headSha: decision.headSha })).toBeUndefined();
    db.prepare("DELETE FROM sessions WHERE id = 's1';").run();
    expect(findInstallDecision(db, decision)).toBeUndefined();
  });

  test('per repository the safeguard is on by default; tool paths are per executable', ({
    expect,
    db,
  }) => {
    expect(findRepositoryInstallSettings(db, '/repo')).toStrictEqual({
      repoPath: '/repo',
      safeguard: true,
      override: undefined,
    });
    saveRepositoryInstallSettings(db, { repoPath: '/repo', safeguard: false, override: '{}' });
    expect(findRepositoryInstallSettings(db, '/repo')).toStrictEqual({
      repoPath: '/repo',
      safeguard: false,
      override: '{}',
    });
    saveToolPath(db, { executable: 'uv', directory: '/opt/uv/bin' });
    saveToolPath(db, { executable: 'bun', directory: '/b' });
    saveToolPath(db, { executable: 'bun', directory: '' });
    expect(listToolPaths(db)).toStrictEqual(new Map([['uv', '/opt/uv/bin']]));
  });
});
