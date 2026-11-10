import { test } from '#testing/test.ts';

import { suggestSetupCommand } from './suggest-setup-command.ts';

test.for([
  [['package.json', 'package-lock.json'], 'npm ci'],
  [['package.json', 'pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
  [['package.json', 'yarn.lock'], 'yarn install --frozen-lockfile'],
  [['package.json'], 'npm install'],
  [['go.mod', 'go.sum'], 'go mod download'],
  [['package-lock.json', 'go.mod'], 'npm ci && go mod download'],
  [['README.md'], ''],
] as const)('suggests from %j: %j', ([files, command], { expect }) => {
  expect(suggestSetupCommand(new Set(files))).toBe(command);
});
