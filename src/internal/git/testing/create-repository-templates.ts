import { constants, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { createTestRepository } from './create-test-repository.ts';
import { openTestRepository } from './open-test-repository.ts';
import type { RepositoryTemplate, TestRepository } from './test-repository.ts';

/** Builds each {@link RepositoryTemplate} once and hands out copies of it. */
export interface RepositoryTemplates {
  /**
   * A copy of `template` at `<home>/repo`; `home` must exist and hold no `repo` yet. `signal`
   * bounds the copy's git commands, not the build, which tests share.
   */
  readonly copy: <T>(
    template: RepositoryTemplate<T>,
    home: string,
    signal?: AbortSignal,
  ) => Promise<{ readonly repo: TestRepository; readonly value: T }>;
}

interface Built {
  readonly directory: string;
  readonly value: unknown;
}

/**
 * Templates live under `root` (one directory per name). A copy is a recursive `fs.cpSync` with
 * `COPYFILE_FICLONE`: a copy-on-write clone where the file system supports it (APFS, Btrfs, XFS)
 * and a plain copy elsewhere, both far cheaper than `git init` plus commits (ADR 0058). Git's lock files
 * are not copied: they are transient, and one that vanishes mid-copy fails the whole `cp`.
 */
export function createRepositoryTemplates(root: string): RepositoryTemplates {
  const built = new Map<string, Promise<Built>>();

  const buildOnce = async <T>(template: RepositoryTemplate<T>, home: string): Promise<Built> => {
    const repo = await createTestRepository(home);
    return { directory: repo.directory, value: await template.build(repo) };
  };

  // The promise is cached, so concurrent tests asking for one template share a single build.
  const build = async <T>(template: RepositoryTemplate<T>): Promise<Built> => {
    const cached = built.get(template.name);
    if (cached !== undefined) {
      return cached;
    }
    const home = path.join(root, `template-${String(built.size + 1)}`);
    mkdirSync(home);
    const entry = buildOnce(template, home);
    built.set(template.name, entry);
    return entry;
  };

  return {
    copy: async <T>(
      template: RepositoryTemplate<T>,
      home: string,
      signal?: AbortSignal,
    ): Promise<{ readonly repo: TestRepository; readonly value: T }> => {
      const source = await build(template);
      cpSync(source.directory, path.join(home, 'repo'), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        filter: (entry): boolean => !isGitLockFile(entry),
      });
      return { repo: openTestRepository(home, signal), value: source.value as T };
    },
  };
}

function isGitLockFile(entry: string): boolean {
  return entry.endsWith('.lock') && entry.includes(`${path.sep}.git${path.sep}`);
}
