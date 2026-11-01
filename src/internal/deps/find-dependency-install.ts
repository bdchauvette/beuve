import type { DatabaseSync } from 'node:sqlite';

import type { DependencyInstall, InstallState } from './dependency-install.ts';
import type { ToolUse } from './plan-install.ts';

const states: ReadonlySet<string> = new Set(['pending', 'running', 'done', 'failed', 'declined']);

/** The install recorded for a checkout, or `undefined` when none is (or the row is unreadable). */
export function findDependencyInstall(
  db: DatabaseSync,
  checkoutPath: string,
): DependencyInstall | undefined {
  const row = db
    .prepare('SELECT * FROM dependency_installs WHERE checkout_path = ?;')
    .get(checkoutPath);
  if (row === undefined) {
    return undefined;
  }
  const state = String(row['state']);
  if (!isInstallState(state)) {
    return undefined;
  }
  const reason = row['reason'];
  return {
    checkoutPath,
    repoPath: String(row['repo_path']),
    commitSha: String(row['commit_sha']),
    state,
    tools: toolsFrom(String(row['tools'])),
    reason: optionalString(reason),
    logTail: String(row['log_tail']),
    updatedAt: String(row['updated_at']),
  };
}

function isInstallState(value: string): value is InstallState {
  return states.has(value);
}

function toolsFrom(text: string): readonly ToolUse[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry: unknown): ToolUse[] => {
      if (typeof entry !== 'object' || entry === null) {
        return [];
      }
      const { tool, version } = entry as Record<string, unknown>;
      if (typeof tool !== 'string') {
        return [];
      }
      return [{ tool, version: optionalString(version) }];
    });
  } catch {
    return [];
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}
