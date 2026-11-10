import type { UraVerdictView } from '#contract/ipc-contract.ts';

import { nounFor } from './noun-for.ts';

/** The verdict the dock exports with, and why a chosen one was refused. */
export interface DockVerdict {
  readonly value: UraVerdictView;
  readonly source: 'derived' | 'chosen';
  readonly refusal?: string;
}

/**
 * The reviewer's chosen verdict over the derived default (ADR 0023): choosing the derived value
 * is no choice at all, and approving while blocking notes are staged is refused, falling back to the
 * derived verdict with a message saying why.
 */
export function resolveDockVerdict(
  chosen: UraVerdictView | undefined,
  derived: UraVerdictView,
  blocking: number,
): DockVerdict {
  if (chosen === 'approve' && blocking > 0) {
    const staged = nounFor(blocking, {
      one: 'a blocking note is',
      other: `${String(blocking)} blocking notes are`,
    });
    const them = nounFor(blocking, { one: 'it', other: 'them' });
    return {
      value: derived,
      source: 'derived',
      refusal: `Can't approve while ${staged} staged: withdraw ${them} or turn off Blocking.`,
    };
  }
  if (chosen === undefined || chosen === derived) {
    return { value: derived, source: 'derived' };
  }
  return { value: chosen, source: 'chosen' };
}
