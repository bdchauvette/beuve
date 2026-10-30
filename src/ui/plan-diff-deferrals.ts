import type { DiffFileView, FileAttributesView } from '#contract/ipc-contract.ts';

/** Why a card starts collapsed (ADR 0052), most specific first. */
export type DeferralReason = 'no-diff' | 'generated' | 'lockfile' | 'large';

/** A card that starts collapsed behind "Load diff", and why. */
export interface DiffDeferral {
  readonly reason: DeferralReason;
  /** One sentence for the collapsed body and the tooltip. */
  readonly why: string;
  /** Lines of patch text and its length, for the summary. */
  readonly rows: number;
  readonly characters: number;
  /** Generated (or `-diff`) and nothing more, so showing generated files expands it. */
  readonly isGeneratedOnly: boolean;
}

/** Past either limit a diff is too heavy to render unasked (ADR 0050). */
export interface DeferralLimits {
  readonly maxRows: number;
  readonly maxCharacters: number;
}

const defaultLimits: DeferralLimits = { maxRows: 3000, maxCharacters: 256 * 1024 };

/** Lockfiles by file name: resolved dependency trees nobody reviews line by line. */
const lockfileNames: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'deno.lock',
  'Cargo.lock',
  'go.sum',
  'go.work.sum',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'pdm.lock',
  'Gemfile.lock',
  'composer.lock',
  'mix.lock',
  'pubspec.lock',
  'Podfile.lock',
  'Package.resolved',
  'packages.lock.json',
  'gradle.lockfile',
  'flake.lock',
  'renv.lock',
]);

/**
 * Paths GitHub's Linguist also counts as generated, kept to cheap, unambiguous name patterns:
 * minified bundles, source maps, protobuf output and `__generated__` folders.
 * `.gitattributes` overrides every one of them.
 */
const generatedPatterns: readonly RegExp[] = [
  /\.min\.(?:js|mjs|cjs|css)$/u,
  /\.(?:js|mjs|cjs|css)\.map$/u,
  /\.pb\.(?:go|cc|h)$/u,
  /_pb2(?:_grpc)?\.pyi?$/u,
  /(?:^|\/)__generated__\//u,
];

/**
 * Which review files start collapsed (ADR 0052), by path: `-diff` and `linguist-generated` from
 * `.gitattributes` at the head; lockfiles and the name patterns above unless `.gitattributes`
 * says `linguist-generated=false`; and any patch over `limits` (lines or characters). Files
 * without hunks render nothing heavy and are never deferred. Pure.
 */
export function planDiffDeferrals(
  files: readonly DiffFileView[],
  attributes: FileAttributesView | undefined,
  limits: DeferralLimits = defaultLimits,
): ReadonlyMap<string, DiffDeferral> {
  const generated = new Set(attributes?.generated);
  const notGenerated = new Set(attributes?.notGenerated);
  const noDiff = new Set(attributes?.noDiff);
  const deferrals = new Map<string, DiffDeferral>();
  for (const file of files) {
    if (file.hunks.length === 0) {
      continue;
    }
    const rows = countRows(file.patch);
    const characters = file.patch.length;
    const isLarge = rows > limits.maxRows || characters > limits.maxCharacters;
    const isGuessed = !notGenerated.has(file.path);
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const plan = ((): { reason: DeferralReason; why: string } | undefined => {
      if (noDiff.has(file.path)) {
        return { reason: 'no-diff', why: '.gitattributes turns this file’s diff off (-diff).' };
      }
      if (generated.has(file.path)) {
        return { reason: 'generated', why: '.gitattributes marks this file linguist-generated.' };
      }
      if (isGuessed && lockfileNames.has(name)) {
        return { reason: 'lockfile', why: 'Lockfiles are not rendered by default.' };
      }
      if (isGuessed && generatedPatterns.some((pattern) => pattern.test(file.path))) {
        return { reason: 'generated', why: 'This file looks generated (by its name).' };
      }
      return isLarge
        ? { reason: 'large', why: 'Large diffs are not rendered by default.' }
        : undefined;
    })();
    if (plan === undefined) {
      continue;
    }
    const isGeneratedOnly = (plan.reason === 'generated' || plan.reason === 'no-diff') && !isLarge;
    deferrals.set(file.path, { ...plan, rows, characters, isGeneratedOnly });
  }
  return deferrals;
}

function countRows(patch: string): number {
  let rows = 0;
  for (let index = patch.indexOf('\n'); index !== -1; index = patch.indexOf('\n', index + 1)) {
    rows += 1;
  }
  return rows;
}
