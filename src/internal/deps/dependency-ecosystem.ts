/** The language ecosystems beuve installs for (ADR 0089). `.beuve/config.json` can skip one. */
export type Ecosystem = 'node' | 'python' | 'php' | 'ruby' | 'go' | 'rust';

/** One row of the detection table: a package manager and how it installs from a lockfile. */
export type ToolId =
  | 'pnpm'
  | 'bun'
  | 'yarn-berry'
  | 'yarn-classic'
  | 'npm'
  | 'uv'
  | 'poetry'
  | 'pip'
  | 'composer'
  | 'bundler'
  | 'go'
  | 'cargo';

/**
 * Where a row's executable comes from: `corepack` runs it on beuve's resolved Node through the
 * bundled corepack (ADR 0091), `host` finds it with toolchain discovery (ADR 0089).
 */
export type ToolchainKind = 'corepack' | 'host';

/** What a directory of the reviewed tree holds, for a row to decide whether it applies. */
export interface DirectoryFacts {
  /** The file names directly in the directory. */
  readonly names: ReadonlySet<string>;
  /** `package.json`'s `packageManager` there, e.g. `yarn@4.9.2`, when it has one. */
  readonly packageManager: string | undefined;
}

/** What an install step is built from: the unit's lockfiles and the row's own cache directory. */
export interface StepContext {
  /** The unit's lockfile names, in its directory. */
  readonly lockfiles: readonly string[];
  /** `<userData>/deps/cache/<row cache>`, shared across checkouts (ADR 0082: 0700). */
  readonly cache: string;
}

/** Argument vectors after the executable, one per process. */
export type InstallArgs = readonly (readonly string[])[];

/** Variables a step adds to the install environment. */
export type StepEnvironment = Readonly<Record<string, string>>;

/** One executable that can serve a row, tried in order: `rv` before `bundle`. */
export interface ToolCandidate {
  /** Looked up by toolchain discovery, or the corepack shim name (`pnpm`, `yarn`, `npm`). */
  readonly executable: string;
  readonly toolchain: ToolchainKind;
  /** The install, as argument vectors after the executable, run in the unit's directory. */
  readonly steps: (context: StepContext) => InstallArgs;
  /** Variables the install needs, chiefly its isolated cache. */
  readonly env: (context: StepContext) => StepEnvironment;
}

/**
 * A row of the detection table (ADR 0089): the files that select it, the files that are its
 * dependency inputs (the safeguard's list, ADR 0090), and the executables that install it.
 * Adding an ecosystem is a row here plus, for a new kind of toolchain, a finder in main.
 */
export interface EcosystemRow {
  readonly tool: ToolId;
  readonly ecosystem: Ecosystem;
  /** What the status line calls it: `pnpm`, `yarn (berry)`. */
  readonly label: string;
  /** Lockfile names (or patterns) that select this row in a directory. */
  readonly lockfiles: readonly (string | RegExp)[];
  /** Further conditions on the directory, after a lockfile matched. */
  readonly when?: (facts: DirectoryFacts) => boolean;
  /** Manifests whose change counts as a dependency change. */
  readonly manifests: readonly (string | RegExp)[];
  /** The package manager's configuration files, also dependency inputs. */
  readonly config: readonly string[];
  /** The directory under the shared cache root this row's installs share. */
  readonly cache: string;
  readonly candidates: readonly ToolCandidate[];
  /** How to get the tool when no candidate is found. */
  readonly fix: string;
}
