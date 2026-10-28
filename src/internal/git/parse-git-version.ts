/** The installed git's version, from `git --version`. */
export interface GitVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The full `git --version` line, e.g. `git version 2.39.3 (Apple Git-145)`. */
  readonly raw: string;
}

const versionPattern = /^git version (\d+)\.(\d+)\.?(\d*)/u;

/** Parses `git --version` output; `undefined` if it doesn't look like git. */
export function parseGitVersion(text: string): GitVersion | undefined {
  const raw = text.trim();
  const match = versionPattern.exec(raw);
  if (match === null) {
    return undefined;
  }
  const [, major = '', minor = '', patch = ''] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: patch === '' ? 0 : Number(patch),
    raw,
  };
}
