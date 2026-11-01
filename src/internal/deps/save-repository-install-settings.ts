import type { DatabaseSync } from 'node:sqlite';

import type { RepositoryInstallSettings } from './dependency-install.ts';

/** Stores a repository's safeguard switch and override, replacing what it had. */
export function saveRepositoryInstallSettings(
  db: DatabaseSync,
  settings: RepositoryInstallSettings,
): void {
  let safeguard = 0;
  if (settings.safeguard) {
    safeguard = 1;
  }
  db.prepare(
    `INSERT INTO dependency_repository_settings (repo_path, safeguard, install_override)
      VALUES (?, ?, NULLIF(?, ''))
      ON CONFLICT (repo_path) DO UPDATE SET
        safeguard = excluded.safeguard, install_override = excluded.install_override;`,
  ).run(settings.repoPath, safeguard, settings.override ?? '');
}
