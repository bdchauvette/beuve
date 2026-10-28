import path from 'node:path';

import { readSettingsFile } from '../settings/read-settings-file.ts';
import { updateSettingsFile } from '../settings/update-settings-file.ts';

/** A GitHub repository, `host/owner/repo`, as the key of a remembered clone. */
export interface RepositoryKey {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

/** The local clone last used for each GitHub repository (ADR 0037). */
export interface ClonePathSettings {
  readonly read: (repository: RepositoryKey) => Promise<string | undefined>;
  readonly write: (repository: RepositoryKey, repoPath: string) => Promise<void>;
}

const settingsKey = 'githubClonePaths';

/**
 * Remembers clone paths in `settings.json` under `githubClonePaths`, keyed by lowercase
 * `host/owner/repo`, keeping every other key. Without a file, in memory. Only absolute paths
 * are read back.
 */
export function createClonePathSettings(filePath?: string): ClonePathSettings {
  const remembered = new Map<string, string>();
  return {
    read: async (repository): Promise<string | undefined> => {
      if (filePath === undefined) {
        return remembered.get(keyOf(repository));
      }
      const settings = await readSettingsFile(filePath);
      const paths = settings[settingsKey];
      const value =
        typeof paths === 'object' && paths !== null
          ? (paths as Record<string, unknown>)[keyOf(repository)]
          : undefined;
      return typeof value === 'string' && path.isAbsolute(value) ? value : undefined;
    },
    write: async (repository, repoPath): Promise<void> => {
      remembered.set(keyOf(repository), repoPath);
      if (filePath === undefined) {
        return;
      }
      await updateSettingsFile(filePath, (current) => {
        const paths = current[settingsKey];
        const previous = typeof paths === 'object' && paths !== null ? paths : {};
        return { ...current, [settingsKey]: { ...previous, [keyOf(repository)]: repoPath } };
      });
    },
  };
}

function keyOf(repository: RepositoryKey): string {
  return `${repository.host}/${repository.owner}/${repository.repo}`.toLowerCase();
}
