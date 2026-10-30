import type { MechanicalReason } from './mechanical-reason.ts';

/** What the classifier knows about a file beyond its path; main computes these from git. */
export interface FileFacts {
  /** `linguist-generated` is set for the path (`.gitattributes`). */
  readonly isGenerated: boolean;
  /** The file's diff has no line left under `git diff --ignore-all-space`. */
  readonly isWhitespaceOnly: boolean;
  /** A 100% similar rename with no content change. */
  readonly isPureRename: boolean;
}

/** One classification rule, as data. Rules are tried in order; the first that matches wins. */
export type MechanicalRule =
  | { readonly reason: MechanicalReason; readonly kind: 'path'; readonly pattern: RegExp }
  | { readonly reason: MechanicalReason; readonly kind: 'fact'; readonly fact: keyof FileFacts };

/**
 * The default rules for a file's place in the review order (ADR 0065). Patterns match the
 * `/`-separated repository path.
 */
export const mechanicalRules: readonly MechanicalRule[] = [
  {
    reason: 'lockfile',
    kind: 'path',
    pattern:
      /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|flake\.lock|pubspec\.lock|Podfile\.lock|mix\.lock|packages\.lock\.json)$/u,
  },
  { reason: 'generated', kind: 'fact', fact: 'isGenerated' },
  {
    reason: 'generated',
    kind: 'path',
    pattern: /(?:\.min\.(?:js|css)|\.map|\.pb\.go|_pb2\.pyi?)$/u,
  },
  { reason: 'pure-rename', kind: 'fact', fact: 'isPureRename' },
  { reason: 'formatting-only', kind: 'fact', fact: 'isWhitespaceOnly' },
  { reason: 'config', kind: 'path', pattern: /(?:^|\/)package\.json$/u },
  { reason: 'config', kind: 'path', pattern: /(?:^|\/)tsconfig[^/]*\.json$/u },
  { reason: 'config', kind: 'path', pattern: /(?:^|\/)[^/]+\.config\.(?:[cm]?[jt]s|json|ya?ml)$/u },
  { reason: 'config', kind: 'path', pattern: /^\.github\// },
  {
    reason: 'config',
    kind: 'path',
    pattern:
      /(?:^|\/)(?:\.eslintrc[^/]*|\.eslintignore|eslint\.config\.[^/]+|\.prettierrc[^/]*|\.prettierignore|prettier\.config\.[^/]+|\.editorconfig|\.stylelintrc[^/]*|\.dependency-cruiser\.[^/]+|\.node-version|\.nvmrc|\.npmrc|\.gitignore|\.gitattributes)$/u,
  },
  { reason: 'config', kind: 'path', pattern: /^[^/]+\.(?:ya?ml|toml)$/u },
];
