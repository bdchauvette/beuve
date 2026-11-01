import type { DatabaseSync } from 'node:sqlite';

/** The reviewer's per-tool directories from Settings, executable → directory (ADR 0089). */
export function listToolPaths(db: DatabaseSync): ReadonlyMap<string, string> {
  const rows = db
    .prepare('SELECT executable, directory FROM dependency_tool_paths ORDER BY executable;')
    .all();
  return new Map(
    rows.map((row) => {
      return [String(row['executable']), String(row['directory'])];
    }),
  );
}
