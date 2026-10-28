import type { GitVersion } from './parse-git-version.ts';

/** True when `version` is `major.minor` or newer. */
export function isVersionAtLeast(version: GitVersion, major: number, minor: number): boolean {
  return version.major > major || (version.major === major && version.minor >= minor);
}
