/** A file at the top of a checkout that hints at its install command. */
export interface SetupHint {
  readonly file: string;
  readonly command: string;
  /** Hints of one group exclude each other: the first present wins. */
  readonly group: string;
}

/**
 * The files whose presence at the top of the head's tree suggests a setup command (ADR 0130), in
 * order of preference within each group: a lockfile names the package manager, so it comes before
 * the manifest that says only that there are packages.
 */
export const setupHints: readonly SetupHint[] = Object.freeze([
  { file: 'pnpm-lock.yaml', command: 'pnpm install --frozen-lockfile', group: 'node' },
  { file: 'yarn.lock', command: 'yarn install --frozen-lockfile', group: 'node' },
  { file: 'bun.lock', command: 'bun install --frozen-lockfile', group: 'node' },
  { file: 'bun.lockb', command: 'bun install --frozen-lockfile', group: 'node' },
  { file: 'package-lock.json', command: 'npm ci', group: 'node' },
  { file: 'package.json', command: 'npm install', group: 'node' },
  { file: 'go.mod', command: 'go mod download', group: 'go' },
  { file: 'Cargo.toml', command: 'cargo fetch', group: 'rust' },
  { file: 'Gemfile', command: 'bundle install', group: 'ruby' },
  { file: 'uv.lock', command: 'uv sync --frozen', group: 'python' },
  { file: 'poetry.lock', command: 'poetry install', group: 'python' },
]);
