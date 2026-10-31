import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { errorFrom } from '#x/error/error-from.ts';
import { nextCalverVersion } from '../src/release/next-calver-version.ts';

const versionFiles = ['package.json', 'package-lock.json'];

release();

/**
 * `npm run release` cuts the next calendar version `YYYY.M.N` (ADR 0049): it bumps `package.json`
 * and `package-lock.json`, commits `chore(release): <version>` and creates the annotated tag
 * `v<version>`. It never pushes. The date is read in UTC, so a release made late in the evening
 * west of Greenwich belongs to the next UTC day, and the version is the same wherever it runs.
 * Refuses unless on `main`, clean, and equal to `origin/main`.
 */
function release(): void {
  try {
    ensureReleasable();
    const version = nextCalverVersion(
      git(['tag', '--list', 'v*']).split('\n'),
      Temporal.Now.plainDateISO('UTC'),
    );
    setVersion(version);
    git(['add', ...versionFiles]);
    git(['commit', '-m', `chore(release): ${version}`]);
    git(['tag', '--annotate', `v${version}`, '-m', `beuve ${version}`]);
    console.log(`Created commit and tag v${version}. Publish with:\n`);
    console.log('  git push --follow-tags origin main');
  } catch (error) {
    console.error(`release: ${errorFrom(error).message}`);
    process.exitCode = 1;
  }
}

function ensureReleasable(): void {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    throw new Error(`must run on main, not ${branch}`);
  }
  if (git(['status', '--porcelain']) !== '') {
    throw new Error('the working tree is not clean');
  }
  git(['fetch', '--tags', 'origin', 'main']);
  const local = git(['rev-parse', 'HEAD']);
  const remote = git(['rev-parse', 'origin/main']);
  if (local !== remote) {
    throw new Error('local main differs from origin/main; pull or push first');
  }
}

/** Sets `version` in `package.json`, and in `package-lock.json` at the top and for the root package. */
function setVersion(version: string): void {
  for (const file of versionFiles) {
    const json = JSON.parse(readFileSync(file, 'utf8')) as {
      version: string;
      packages?: Record<string, { version?: string }>;
    };
    json.version = version;
    const root = json.packages?.[''];
    if (root !== undefined) {
      root.version = version;
    }
    writeFileSync(file, `${JSON.stringify(json, undefined, 2)}\n`);
  }
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8' }).trim();
}
