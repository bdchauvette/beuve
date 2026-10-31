import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import { isVersionAtLeast } from '../is-version-at-least.ts';
import { parseGitVersion } from '../parse-git-version.ts';
import type { GitVersion } from '../parse-git-version.ts';

/** A ref backend `git init --ref-format` takes. */
export type RefFormat = 'files' | 'reftable';

/** The newest git a test can run, and the ref backend it makes repositories with. */
export interface NewestGit {
  readonly binary: string;
  readonly version: GitVersion;
  /** `reftable` from git 2.45, else `files`. */
  readonly refFormat: RefFormat;
}

/** The environment {@link resolveNewestGit} reads; tests pass `process.env`. */
export interface NewestGitEnvironment {
  /** Another git to consider besides `git` on `PATH`, e.g. one built for the reftable tests. */
  readonly BEUVE_TEST_GIT?: string | undefined;
  /** `1`: refuse a git too old for reftable instead of falling back to `files` (CI sets it). */
  readonly BEUVE_REQUIRE_REFTABLE?: string | undefined;
}

const reftableSince = { major: 2, minor: 45 };

/**
 * Picks the newest of `git` on `PATH` and `BEUVE_TEST_GIT`. Its repositories use the reftable
 * backend when it supports one (git 2.45+), else the files backend, so the same tests run on
 * whatever git a machine has; with `BEUVE_REQUIRE_REFTABLE=1` an older git is an error, which
 * is how CI guarantees the reftable tests really ran.
 */
export async function resolveNewestGit(
  environment: NewestGitEnvironment = process.env,
  signal?: AbortSignal,
): Promise<NewestGit> {
  const candidates = ['git', environment.BEUVE_TEST_GIT].filter((binary) => {
    return binary !== undefined && binary !== '';
  }) as string[];
  const found = await Promise.all(
    candidates.map(async (binary) => {
      return versionOf(binary, signal);
    }),
  );
  const newest = found
    .filter((git) => git !== undefined)
    .toSorted((a, b) => compareVersions(b.version, a.version))
    .at(0);
  if (newest === undefined) {
    throw new Error(`No git runs here (tried ${candidates.join(', ')}).`);
  }
  const refFormat = refFormatOf(newest.version);
  if (refFormat === 'files' && environment.BEUVE_REQUIRE_REFTABLE === '1') {
    throw new Error(
      `BEUVE_REQUIRE_REFTABLE is set, but the newest git (${newest.version.raw}, ${newest.binary}) is older than 2.45; set BEUVE_TEST_GIT to a newer one.`,
    );
  }
  return { ...newest, refFormat };
}

/** A git binary and its version. */
interface FoundGit {
  readonly binary: string;
  readonly version: GitVersion;
}

async function versionOf(binary: string, signal?: AbortSignal): Promise<FoundGit | undefined> {
  try {
    const { stdout } = await promisify(execFile)(binary, ['--version'], {
      encoding: 'utf8',
      signal,
    });
    const version = parseGitVersion(stdout);
    if (version === undefined) {
      return undefined;
    }
    return { binary, version };
  } catch {
    return undefined;
  }
}

function compareVersions(a: GitVersion, b: GitVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function refFormatOf(version: GitVersion): RefFormat {
  if (isVersionAtLeast(version, reftableSince)) {
    return 'reftable';
  }
  return 'files';
}
