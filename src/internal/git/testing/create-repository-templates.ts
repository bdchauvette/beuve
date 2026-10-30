import { constants, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { createTestRepository } from './create-test-repository.ts';
import { openTestRepository } from './open-test-repository.ts';
import type { RepositoryTemplate, TestRepository } from './test-repository.ts';

/** Builds each {@link RepositoryTemplate} once and hands out copies of it. */
export interface RepositoryTemplates {
  /** A copy of `template` at `<home>/repo`; `home` must exist and hold no `repo` yet. */
  readonly copy: <T>(
    template: RepositoryTemplate<T>,
    home: string,
  ) => { readonly repo: TestRepository; readonly value: T };
}

interface Built {
  readonly directory: string;
  readonly value: unknown;
}

/**
 * Templates live under `root` (one directory per name). A copy is a recursive `fs.cpSync` with
 * `COPYFILE_FICLONE`: a copy-on-write clone where the file system supports it (APFS, Btrfs, XFS)
 * and a plain copy elsewhere, both far cheaper than `git init` plus commits (ADR 0058).
 */
export function createRepositoryTemplates(root: string): RepositoryTemplates {
  const built = new Map<string, Built>();

  const build = <T>(template: RepositoryTemplate<T>): Built => {
    const cached = built.get(template.name);
    if (cached !== undefined) {
      return cached;
    }
    const home = path.join(root, `template-${String(built.size + 1)}`);
    mkdirSync(home);
    const repo = createTestRepository(home);
    const entry = { directory: repo.directory, value: template.build(repo) };
    built.set(template.name, entry);
    return entry;
  };

  return {
    copy: <T>(
      template: RepositoryTemplate<T>,
      home: string,
    ): { readonly repo: TestRepository; readonly value: T } => {
      const source = build(template);
      cpSync(source.directory, path.join(home, 'repo'), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
      return { repo: openTestRepository(home), value: source.value as T };
    },
  };
}
