import type { CommandId } from '#contract/command-catalog.ts';

import type { DockSelectionFacts } from './dock-selection-facts.ts';

/**
 * The Note commands that show their checked names for these notes (ADR 0144): Restore while
 * every one is withdrawn, Mark as Not Addressed and Mark as Not Blocking while every one is
 * addressed or blocking; the context menu's Status and Label check the status and label they all
 * share (ADR 0150). Pure.
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
  if (facts?.status !== undefined) {
    checked.push(statusCommands[facts.status]);
  }
  if (facts?.severity !== undefined) {
    checked.push(`dock-label-${facts.severity}`);
  }
  return checked;
}

const statusCommands: Readonly<Record<'staged' | 'withdrawn' | 'addressed', CommandId>> = {
  staged: 'dock-status-open',
  withdrawn: 'dock-status-withdrawn',
  addressed: 'dock-status-addressed',
};
