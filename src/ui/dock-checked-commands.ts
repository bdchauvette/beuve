import type { CommandId } from '#contract/command-catalog.ts';

import type { DockSelectionFacts } from './dock-selection-facts.ts';

/**
 * The Note commands that show their checked names for these notes (ADR 0144): Restore while
 * every one is withdrawn, Mark as Not Addressed and Mark as Not Blocking while every one is
 * addressed or blocking. Pure.
 */
export function dockCheckedCommands(facts: DockSelectionFacts | undefined): CommandId[] {
  const checked: CommandId[] = [];
  if (facts?.isAddressed === true) {
    checked.push('dock-addressed');
  }
  if (facts?.isWithdrawn === true) {
    checked.push('dock-withdraw');
  }
  if (facts?.isBlocking === true) {
    checked.push('dock-blocking');
  }
  return checked;
}
