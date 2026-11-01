import { chmodSync } from 'node:fs';
import path from 'node:path';

import type { RepositoryTemplate, TestRepository } from '#internal/git/testing/test-repository.ts';

/**
 * An npm project on `main`, with branches from it: `feature` changes a source file only,
 * `lock-change` the lockfile, `bun` adds a bun project (no bun is installed), `configured` adds
 * `.beuve/config.json` (a step) and an executable `.beuve/hooks/install`, `bad-config` an
 * invalid configuration, and `hanging` a step that never ends.
 */
export function dependencyTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-deps: npm project with branches',
    build: async (repo): Promise<undefined> => {
      repo.write('package.json', JSON.stringify({ name: 'fixture', private: true }));
      repo.write('package-lock.json', JSON.stringify({ lockfileVersion: 3 }));
      repo.write('src/a.ts', 'export function a(): number {\n  return 1;\n}\n');
      repo.write('src/a.test.ts', "import { a } from './a.ts';\ntest('a', () => a());\n");
      await repo.commit('base');
      await branch(repo, 'feature', () => {
        repo.write('src/a.ts', 'export function a(): number {\n  return 2;\n}\n');
      });
      await branch(repo, 'lock-change', () => {
        repo.write('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
      });
      await branch(repo, 'bun', () => {
        repo.write('web/package.json', '{}');
        repo.write('web/bun.lock', '{}');
      });
      await branch(repo, 'configured', () => {
        repo.write(
          '.beuve/config.json',
          JSON.stringify({ install: { steps: [{ run: ['npm', 'run', 'gen'], cwd: 'src' }] } }),
        );
        repo.write(
          '.beuve/hooks/install',
          '#!/bin/sh\nprintf "%s %s %s\\n" "$BEUVE_HEAD_SHA" "$BEUVE_SESSION_ID" "$PWD" > hook-ran\n',
        );
        chmodSync(path.join(repo.directory, '.beuve/hooks/install'), 0o755);
      });
      await branch(repo, 'bad-config', () => {
        repo.write('.beuve/config.json', JSON.stringify({ install: { steps: [{ run: 'x' }] } }));
      });
      await branch(repo, 'hanging', () => {
        repo.write(
          '.beuve/config.json',
          JSON.stringify({ install: { skip: ['node'], steps: [{ run: ['hang'] }] } }),
        );
      });
    },
  };
}

async function branch(repo: TestRepository, name: string, change: () => void): Promise<void> {
  await repo.git('switch', '--quiet', '-c', name, 'main');
  change();
  await repo.commit(name);
  await repo.git('switch', '--quiet', 'main');
}
