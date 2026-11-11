import { setupHints } from './setup-hints.ts';

/**
 * A first guess at a repository's setup command from the files at the top of its head (ADR 0130):
 * one install per ecosystem found, joined with `&&` (a pnpm lockfile wins over `package.json`).
 * Only ever a suggestion the reviewer edits before it is stored; empty when nothing is recognized.
 */
export function suggestSetupCommand(present: ReadonlySet<string>): string {
  const groups = new Set<string>();
  const commands: string[] = [];
  for (const hint of setupHints) {
    if (!present.has(hint.file) || groups.has(hint.group)) {
      continue;
    }

    groups.add(hint.group);
    commands.push(hint.command);
  }
  return commands.join(' && ');
}
