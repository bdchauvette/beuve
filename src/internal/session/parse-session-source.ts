import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SessionError, SessionSource } from './session.ts';

const hostCharacters = /^[a-z\d.-]+$/u;

type InvalidSource = Extract<SessionError, { kind: 'invalid-source' }>;

/**
 * Checks the invariants the type can't express: an absolute repository path, non-blank
 * refs and names, a lowercase hostname and a positive integer pull request number.
 */
export function parseSessionSource(source: SessionSource): Result<SessionSource, InvalidSource> {
  const problem = findProblem(source);
  return problem === undefined ? ok(source) : err({ kind: 'invalid-source', reason: problem });
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
      return isBlank(source.headRef) ? 'headRef must not be blank' : undefined;
    }
    case 'github-pull-request': {
      if (isBlank(source.owner) || isBlank(source.repo)) {
        return 'owner and repo must not be blank';
      }
      if (!isHostname(source.host)) {
        return 'host must be a lowercase hostname';
      }
      return Number.isSafeInteger(source.number) && source.number > 0
        ? undefined
        : 'number must be a positive integer';
    }
  }
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
