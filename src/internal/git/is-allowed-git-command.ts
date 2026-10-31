/**
 * Every git subcommand beuve runs, and nothing else (ADR 0088). There is deliberately no `push`,
 * `send-pack`, `http-push`, `remote` or `credential` here: **beuve never pushes**, and its
 * review-edits branches (`review/…`) stay local. Adding a subcommand that can publish refs
 * needs an ADR that supersedes ADR 0088, and `is-allowed-git-command.test.ts` fails until then.
 */
const subcommands: ReadonlySet<string> = new Set([
  '--version',
  'add',
  'cat-file',
  'check-attr',
  'check-ref-format',
  'commit-tree',
  'config',
  'diff',
  'fetch',
  'for-each-ref',
  'grep',
  'log',
  'ls-files',
  'ls-tree',
  'merge-base',
  'merge-tree',
  'patch-id',
  'rev-list',
  'rev-parse',
  'show',
  'status',
  'symbolic-ref',
  'tag',
  'update-ref',
  'worktree',
  'write-tree',
]);

/**
 * Whether `args` (as `execGit` and `streamGit` take them, after the hardening options) run a
 * subcommand on beuve's allow-list. Only `-c <name>=<value>` pairs may come before it. The
 * runners refuse anything else before starting a process.
 */
export function isAllowedGitCommand(args: readonly string[]): boolean {
  let index = 0;
  while (args[index] === '-c' && args[index + 1]?.includes('=') === true) {
    index += 2;
  }
  return subcommands.has(args[index] ?? '');
}
