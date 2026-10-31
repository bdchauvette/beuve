import { lstatSync, readdirSync, readlinkSync } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';

/**
 * Every entry under `root`, sorted, as `path kind size mtime` with a link's target, without
 * following links, so a test can tell that nothing was added, removed, rewritten or touched,
 * dot-entries and `node_modules` included. Test-only (ADR 0013).
 */
export function snapshotTree(root: string): string[] {
  const lines: string[] = [];
  const visit = (relative: string): void => {
    const absolute = path.join(root, relative);
    const stats = lstatSync(absolute);
    lines.push(`${relative || '.'} ${describeEntry(absolute, stats)}`);
    if (!stats.isDirectory()) {
      return;
    }
    const names = readdirSync(absolute).toSorted((left, right) => left.localeCompare(right));
    for (const name of names) {
      visit(path.join(relative, name));
    }
  };
  visit('');
  return lines;
}

function describeEntry(absolute: string, stats: Stats): string {
  const times = `${String(stats.size)} ${String(stats.mtimeMs)}`;
  if (stats.isSymbolicLink()) {
    return `link ${times} -> ${readlinkSync(absolute)}`;
  }
  if (stats.isDirectory()) {
    return `dir ${times}`;
  }
  return `file ${times}`;
}
