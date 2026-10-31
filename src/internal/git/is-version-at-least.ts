import type { GitVersion } from './parse-git-version.ts';

/** True when `version` is `minimum`'s `major.minor` or newer. */
export function isVersionAtLeast(
  version: GitVersion,
  { major, minor }: Pick<GitVersion, 'major' | 'minor'>,
): boolean {
  return version.major > major || (version.major === major && version.minor >= minor);
}
