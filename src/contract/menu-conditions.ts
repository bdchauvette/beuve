import type { MenuCondition } from './command-catalog.ts';

/** Every {@link MenuCondition}, for validating `menu:set-state` in main. */
export const menuConditions = Object.freeze([
  'session',
  'file',
  'diff-target',
  'dock-item',
  'busy',
  'pull-request',
  'staged',
  'back',
  'forward',
  'text-focus',
] as const satisfies readonly MenuCondition[]);
