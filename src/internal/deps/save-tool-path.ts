import type { DatabaseSync } from 'node:sqlite';

/** An executable and the directory searched for it first; `''` removes the override. */
export interface ToolPath {
  readonly executable: string;
  readonly directory: string;
}

/** Stores, replaces or (for an empty directory) removes one tool's directory override. */
export function saveToolPath(db: DatabaseSync, { executable, directory }: ToolPath): void {
  if (directory === '') {
    db.prepare('DELETE FROM dependency_tool_paths WHERE executable = ?;').run(executable);
    return;
  }
  db.prepare(
    `INSERT INTO dependency_tool_paths (executable, directory) VALUES (?, ?)
      ON CONFLICT (executable) DO UPDATE SET directory = excluded.directory;`,
  ).run(executable, directory);
}
