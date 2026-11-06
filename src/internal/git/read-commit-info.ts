import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { GitError } from './git-error.ts';
import { gitRunner } from './git-runner.ts';
import type { CommitSha } from './object-id.ts';
import type { GitRepository } from './open-repository.ts';

/** A commit larger than this (its headers and message) answers `undefined`. */
const maxCommitBytes = 1024 * 1024;

/** Who wrote or committed a commit, and when. */
export interface CommitSignature {
  readonly name: string;
  readonly email: string;
  readonly at: Temporal.Instant;
}

/** A commit's parents, people and message, as its object records them. */
export interface CommitInfo {
  readonly sha: CommitSha;
  readonly parents: readonly CommitSha[];
  readonly author: CommitSignature;
  readonly committer: CommitSignature;
  /** The message's first line. */
  readonly subject: string;
  /** The message after the first line and the blank lines that follow it; empty when none. */
  readonly body: string;
}

export interface ReadCommitInfoOptions {
  readonly signal?: AbortSignal | undefined;
}

const signaturePattern = /^(?<name>.*) <(?<email>[^>]*)> (?<seconds>-?\d+) [+-]\d{4}$/u;
const trailingNewlines = /\n+$/u;
const leadingNewlines = /^\n+/u;

/**
 * Commit `sha`'s parents, author, committer and message, read on the repository's warm
 * `cat-file --batch-command` (ADR 0087) and parsed from the object's headers. `undefined` when the
 * object is missing, is not a commit, is over 1 MiB, or lacks an author or committer line.
 */
export async function readCommitInfo(
  repository: GitRepository,
  sha: CommitSha,
  options: ReadCommitInfoOptions = {},
): Promise<Result<CommitInfo | undefined, GitError>> {
  const read = await repository[gitRunner].objects.read(
    { kind: 'object', oid: sha },
    { maxBytes: maxCommitBytes, signal: options.signal },
  );
  if (!read.ok) {
    return read;
  }
  if (read.value.kind !== 'content' || read.value.type !== 'commit') {
    return ok(undefined);
  }
  return ok(commitInfoFrom(sha, read.value.bytes.toString('utf8')));
}

function commitInfoFrom(sha: CommitSha, text: string): CommitInfo | undefined {
  const separator = text.indexOf('\n\n');
  let headerText = text;
  let message = '';
  if (separator !== -1) {
    headerText = text.slice(0, separator);
    message = text.slice(separator + 2);
  }
  const headers = headerText.split('\n').map((line): readonly [string, string] => {
    const space = line.indexOf(' ');
    return [line.slice(0, space), line.slice(space + 1)];
  });
  const valueOf = (name: string): string | undefined => {
    return headers.find(([key]) => key === name)?.[1];
  };
  const parents = headers
    .filter(([key]) => key === 'parent')
    .map(([, value]) => value as CommitSha);
  const author = signatureFrom(valueOf('author'));
  const committer = signatureFrom(valueOf('committer'));
  if (author === undefined || committer === undefined) {
    return undefined;
  }
  const [subject = '', ...rest] = message.replace(trailingNewlines, '').split('\n');
  return {
    sha,
    parents,
    author,
    committer,
    subject,
    body: rest.join('\n').replace(leadingNewlines, ''),
  };
}

/** `Name <email> 1700000000 +0100`, the seconds since the epoch in UTC. */
function signatureFrom(value: string | undefined): CommitSignature | undefined {
  if (value === undefined) {
    return undefined;
  }
  const groups = signaturePattern.exec(value)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { name = '', email = '', seconds = '0' } = groups;
  return {
    name,
    email,
    at: Temporal.Instant.fromEpochMilliseconds(0).add({ seconds: Number(seconds) }),
  };
}
