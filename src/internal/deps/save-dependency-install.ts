import type { DatabaseSync } from 'node:sqlite';

import type { DependencyInstall } from './dependency-install.ts';

/** Stores a checkout's install, replacing what was recorded for that checkout. */
export function saveDependencyInstall(db: DatabaseSync, install: DependencyInstall): void {
  db.prepare(
    `INSERT INTO dependency_installs
        (checkout_path, repo_path, commit_sha, state, tools, reason, log_tail, updated_at)
      VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?)
      ON CONFLICT (checkout_path) DO UPDATE SET
        repo_path = excluded.repo_path, commit_sha = excluded.commit_sha, state = excluded.state,
        tools = excluded.tools, reason = excluded.reason, log_tail = excluded.log_tail,
        updated_at = excluded.updated_at;`,
  ).run(
    install.checkoutPath,
    install.repoPath,
    install.commitSha,
    install.state,
    JSON.stringify(install.tools),
    install.reason ?? '',
    install.logTail,
    install.updatedAt,
  );
}
