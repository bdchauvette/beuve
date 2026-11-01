import type {
  DirectoryFacts,
  EcosystemRow,
  InstallArgs,
  StepContext,
  StepEnvironment,
} from './dependency-ecosystem.ts';

const nodeManifests = ['package.json'];
const yarnVersion = /^yarn@(\d+)\./u;

/**
 * The detection table (ADR 0089), in priority order: in one directory the first row of an
 * ecosystem whose lockfile is there wins, so a directory with `pnpm-lock.yaml` and a stray
 * `package-lock.json` is a pnpm unit. Every install is the tool's frozen, lockfile-only mode,
 * run in the unit's directory of beuve's checkout, as in a clone, with its cache under
 * `<userData>/deps/cache`. Node package managers run on beuve's Node through corepack, which
 * honours `packageManager` (ADR 0091); the rest are host tools.
 */
export const ecosystemRows: readonly EcosystemRow[] = Object.freeze([
  {
    tool: 'pnpm',
    ecosystem: 'node',
    label: 'pnpm',
    lockfiles: ['pnpm-lock.yaml'],
    manifests: nodeManifests,
    config: ['pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs'],
    cache: 'pnpm-store',
    candidates: [
      {
        executable: 'pnpm',
        toolchain: 'corepack',
        steps: ({ cache }: StepContext): InstallArgs => {
          return [['install', '--frozen-lockfile', '--store-dir', cache]];
        },
        env: (): StepEnvironment => {
          return {};
        },
      },
    ],
    fix: 'beuve runs pnpm through its bundled corepack; check the network, or set pnpm’s path in Settings.',
  },
  {
    tool: 'bun',
    ecosystem: 'node',
    label: 'bun',
    lockfiles: ['bun.lock', 'bun.lockb'],
    manifests: nodeManifests,
    config: ['bunfig.toml', '.npmrc'],
    cache: 'bun',
    candidates: [
      {
        executable: 'bun',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['install', '--frozen-lockfile']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { BUN_INSTALL_CACHE_DIR: cache };
        },
      },
    ],
    fix: 'Install bun (https://bun.sh), or set its path in Settings.',
  },
  {
    tool: 'yarn-berry',
    ecosystem: 'node',
    label: 'yarn (berry)',
    lockfiles: ['yarn.lock'],
    when: isYarnBerry,
    manifests: nodeManifests,
    config: ['.yarnrc.yml', '.npmrc'],
    cache: 'yarn-berry',
    candidates: [
      {
        executable: 'yarn',
        toolchain: 'corepack',
        steps: (): InstallArgs => {
          return [['install', '--immutable']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { YARN_GLOBAL_FOLDER: cache, YARN_ENABLE_TELEMETRY: '0' };
        },
      },
    ],
    fix: 'beuve runs yarn through its bundled corepack; check the network, or set yarn’s path in Settings.',
  },
  {
    tool: 'yarn-classic',
    ecosystem: 'node',
    label: 'yarn (classic)',
    lockfiles: ['yarn.lock'],
    manifests: nodeManifests,
    config: ['.yarnrc', '.npmrc'],
    cache: 'yarn-classic',
    candidates: [
      {
        executable: 'yarn',
        toolchain: 'corepack',
        steps: ({ cache }: StepContext): InstallArgs => {
          return [['install', '--frozen-lockfile', '--non-interactive', '--cache-folder', cache]];
        },
        env: (): StepEnvironment => {
          return {};
        },
      },
    ],
    fix: 'beuve runs yarn through its bundled corepack; check the network, or set yarn’s path in Settings.',
  },
  {
    tool: 'npm',
    ecosystem: 'node',
    label: 'npm',
    lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'],
    manifests: nodeManifests,
    config: ['.npmrc'],
    cache: 'npm',
    candidates: [
      {
        executable: 'npm',
        toolchain: 'corepack',
        steps: ({ cache }: StepContext): InstallArgs => {
          return [['ci', '--no-audit', '--no-fund', '--cache', cache]];
        },
        env: (): StepEnvironment => {
          return {};
        },
      },
    ],
    fix: 'beuve runs npm through its bundled corepack; check the network, or set npm’s path in Settings.',
  },
  {
    tool: 'uv',
    ecosystem: 'python',
    label: 'uv',
    lockfiles: ['uv.lock'],
    manifests: ['pyproject.toml'],
    config: ['uv.toml', '.python-version'],
    cache: 'uv',
    candidates: [
      {
        executable: 'uv',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['sync', '--frozen']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { UV_CACHE_DIR: cache };
        },
      },
    ],
    fix: 'Install uv (`curl -LsSf https://astral.sh/uv/install.sh | sh` or `brew install uv`), or set its path in Settings.',
  },
  {
    tool: 'poetry',
    ecosystem: 'python',
    label: 'poetry',
    lockfiles: ['poetry.lock'],
    manifests: ['pyproject.toml'],
    config: ['poetry.toml', '.python-version'],
    cache: 'poetry',
    candidates: [
      {
        executable: 'poetry',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['install', '--no-interaction']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { POETRY_CACHE_DIR: cache, POETRY_VIRTUALENVS_IN_PROJECT: 'true' };
        },
      },
    ],
    fix: 'Install poetry (`pipx install poetry`), or set its path in Settings.',
  },
  {
    tool: 'pip',
    ecosystem: 'python',
    label: 'pip (uv)',
    lockfiles: [/^requirements.*\.txt$/u],
    manifests: [],
    config: ['.python-version'],
    cache: 'uv',
    candidates: [
      {
        executable: 'uv',
        toolchain: 'host',
        steps: ({ lockfiles }: StepContext): InstallArgs => {
          return [
            ['venv', '--allow-existing', '.venv'],
            ...lockfiles.map((file) => {
              return ['pip', 'install', '--python', '.venv', '-r', file];
            }),
          ];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { UV_CACHE_DIR: cache };
        },
      },
    ],
    fix: 'beuve installs requirements files into a .venv with uv: install uv (`brew install uv`), or set its path in Settings.',
  },
  {
    tool: 'composer',
    ecosystem: 'php',
    label: 'composer',
    lockfiles: ['composer.lock'],
    manifests: ['composer.json'],
    config: ['auth.json'],
    cache: 'composer',
    candidates: [
      {
        executable: 'composer',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['install', '--no-interaction', '--no-progress']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { COMPOSER_CACHE_DIR: cache };
        },
      },
    ],
    fix: 'Install PHP and composer (`brew install composer`), or set composer’s path in Settings.',
  },
  {
    tool: 'bundler',
    ecosystem: 'ruby',
    label: 'bundler',
    lockfiles: ['Gemfile.lock'],
    manifests: ['Gemfile', /\.gemspec$/u],
    config: ['.ruby-version', '.bundle/config'],
    cache: 'bundler',
    candidates: [
      {
        executable: 'rv',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['ci']];
        },
        env: (): StepEnvironment => {
          return { BUNDLE_FROZEN: 'true', BUNDLE_PATH: 'vendor/bundle' };
        },
      },
      {
        executable: 'bundle',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['install']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { BUNDLE_FROZEN: 'true', BUNDLE_PATH: 'vendor/bundle', BUNDLE_USER_CACHE: cache };
        },
      },
    ],
    fix: 'Install rv (`curl -LsSf https://rv.dev/install | sh`) or Ruby with bundler, or set the path in Settings.',
  },
  {
    tool: 'go',
    ecosystem: 'go',
    label: 'go',
    lockfiles: ['go.sum'],
    when: (facts: DirectoryFacts): boolean => {
      return facts.names.has('go.mod');
    },
    manifests: ['go.mod'],
    config: ['go.work'],
    cache: 'go-mod',
    candidates: [
      {
        executable: 'go',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['mod', 'download']];
        },
        env: ({ cache }: StepContext): StepEnvironment => {
          return { GOMODCACHE: cache };
        },
      },
    ],
    fix: 'Install Go (https://go.dev/dl), or set its path in Settings.',
  },
  {
    tool: 'cargo',
    ecosystem: 'rust',
    label: 'cargo',
    lockfiles: ['Cargo.lock'],
    manifests: ['Cargo.toml'],
    config: ['rust-toolchain.toml', 'rust-toolchain', '.cargo/config.toml'],
    cache: 'cargo',
    candidates: [
      {
        executable: 'cargo',
        toolchain: 'host',
        steps: (): InstallArgs => {
          return [['fetch', '--locked']];
        },
        env: (): StepEnvironment => {
          return {};
        },
      },
    ],
    fix: 'Install Rust with rustup (https://rustup.rs), or set cargo’s path in Settings.',
  },
] satisfies readonly EcosystemRow[]);

/** Yarn 2 and later: a `.yarnrc.yml`, or `packageManager` naming yarn 2+. */
function isYarnBerry(facts: DirectoryFacts): boolean {
  if (facts.names.has('.yarnrc.yml')) {
    return true;
  }
  const match = yarnVersion.exec(facts.packageManager ?? '');
  return match !== null && Number(match[1]) >= 2;
}
