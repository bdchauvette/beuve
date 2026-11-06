import { test } from './testing/test.ts';

import { isSafeBranchName } from './is-safe-branch-name.ts';

test.for([
  ['main', true],
  ['claude/fix-login-01AbC', true],
  ['release/2.x', true],
  ['-rf', false],
  ['a..b', false],
  ['a//b', false],
  ['trailing/', false],
  ['x.lock', false],
  ['dir/.hidden', false],
  ['spa ce', false],
  ['caret^', false],
  ['ünïcode', false],
  ['', false],
  ['a'.repeat(251), false],
] as const)('isSafeBranchName(%j) is %s', ([name, expected], { expect }) => {
  expect(isSafeBranchName(name)).toBe(expected);
});
