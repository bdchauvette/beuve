import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { formatReleaseNotes } from '../src/release/format-release-notes.ts';
import type { ReleaseCommit } from '../src/release/format-release-notes.ts';

writeReleaseNotes();

/**
 * Prints Markdown release notes for the version in `package.json` to stdout: the conventional
 * commits since the previous `v*` tag (ADR 0049). `GITHUB_REPOSITORY` names the repository for
 * links. Run from a checkout with tags fetched.
 */
function writeReleaseNotes(): void {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const repository = process.env['GITHUB_REPOSITORY'] ?? 'bdchauvette/beuve';
  const previousTag = findPreviousTag(`v${version}`);
  const range = commitRange(previousTag);
  const log = git(['log', '--no-merges', '--format=%h%x09%s', range]);
  const commits: ReleaseCommit[] = log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [hash = '', ...subject] = line.split('\t');
      return { hash, subject: subject.join('\t') };
    });
  process.stdout.write(formatReleaseNotes({ repository, version, previousTag, commits }));
}

function findPreviousTag(currentTag: string): string | undefined {
  return git(['tag', '--merged', 'HEAD', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .find((tag) => tag !== '' && tag !== currentTag);
}

/** The commits since `previousTag`, or all of them for the first release. */
function commitRange(previousTag: string | undefined): string {
  if (previousTag === undefined) {
    return 'HEAD';
  }
  return `${previousTag}..HEAD`;
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8' }).trim();
}
