import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionError, SessionSource } from './session.ts';

const hostCharacters = /^[a-z\d.-]+$/u;
const forges: ReadonlySet<string> = new Set(['github']);

type InvalidSource = Extract<SessionError, { kind: 'invalid-source' }>;

/**
 * Checks the invariants the type can't express: an absolute repository path, non-blank
 * refs, names and branches, a lowercase hostname, a known forge and a positive integer pull
 * request number.
 */
export function parseSessionSource(source: SessionSource): Result<SessionSource, InvalidSource> {
  const problem = findProblem(source);
  if (problem === undefined) {
    return ok(source);
  }
  return err({ kind: 'invalid-source', reason: problem });
}

function findProblem(source: SessionSource): string | undefined {
  if (!path.isAbsolute(source.repoPath)) {
    return 'repoPath must be absolute';
  }
  if (isBlank(source.baseRef)) {
    return 'baseRef must not be blank';
  }
  switch (source.kind) {
    case 'local': {
      if (isBlank(source.headRef)) {
        return 'headRef must not be blank';
      }
      return undefined;
    }
    case 'github-pull-request': {
      const problem = remoteProblem(source);
      if (problem !== undefined) {
        return problem;
      }
      if (Number.isSafeInteger(source.number) && source.number > 0) {
        return undefined;
      }
      return 'number must be a positive integer';
    }
    case 'remote-branch': {
      const problem = remoteProblem(source);
      if (problem !== undefined) {
        return problem;
      }
      if (!forges.has(source.forge)) {
        return 'forge must be a known forge';
      }
      if (isBlank(source.branch)) {
        return 'branch must not be blank';
      }
      return undefined;
    }
  }
}

/** A hosted repository's host, owner and name. */
interface RemoteRepository {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

function remoteProblem(source: RemoteRepository): string | undefined {
  if (isBlank(source.owner) || isBlank(source.repo)) {
    return 'owner and repo must not be blank';
  }
  if (!isHostname(source.host)) {
    return 'host must be a lowercase hostname';
  }
  return undefined;
}

function isBlank(value: string): boolean {
  return value.trim() === '';
}

function isHostname(host: string): boolean {
  return (
    host.length <= 253 &&
    hostCharacters.test(host) &&
    !host.startsWith('.') &&
    !host.startsWith('-') &&
    !host.endsWith('.') &&
    !host.endsWith('-')
  );
}
