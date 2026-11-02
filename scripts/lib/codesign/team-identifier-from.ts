import { err } from '../../../src/x/result/err.ts';
import { ok } from '../../../src/x/result/ok.ts';
import type { Result } from '../../../src/x/result/result.ts';

const teamLine = /^TeamIdentifier=(\S+)$/m;

/**
 * The team identifier in `codesign -dv --verbose=4` output (which `codesign` writes to stderr).
 * An ad-hoc signature prints `TeamIdentifier=not set`, which is not an identifier.
 */
export function teamIdentifierFrom(details: string): Result<string, string> {
  const match = teamLine.exec(details);
  if (match === null) {
    return err('no TeamIdentifier line');
  }
  const [, identifier] = match;
  if (identifier === undefined || identifier === 'not') {
    return err('the signature has no team identifier (ad hoc)');
  }
  return ok(identifier);
}
