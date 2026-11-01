import type { DatabaseSync } from 'node:sqlite';

import type { RepositoryInstallSettings } from './dependency-install.ts';

/**
 * A repository's install settings; a repository with none stored gets the defaults: the
 * safeguard on (ADR 0090) and no override (ADR 0092).
 */
export function findRepositoryInstallSettings(
  db: DatabaseSync,
  repoPath: string,
): RepositoryInstallSettings {
  const row = db
    .prepare('SELECT * FROM dependency_repository_settings WHERE repo_path = ?;')
    .get(repoPath);
  if (row === undefined) {
    return { repoPath, safeguard: true, override: undefined };
  }
  const override = row['install_override'];
  let text: string | undefined;
  if (typeof override === 'string' && override.trim() !== '') {
    text = override;
  }
  return { repoPath, safeguard: row['safeguard'] !== 0, override: text };
}
