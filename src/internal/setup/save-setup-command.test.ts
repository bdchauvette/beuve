import { findSetupCommand } from './find-setup-command.ts';
import { saveSetupCommand } from './save-setup-command.ts';
import { test } from './testing/test.ts';

test('stores one command per repository, case-insensitively, and replaces it', ({ expect, db }) => {
  expect(findSetupCommand(db, 'github.com/acme/widgets')).toStrictEqual({
    ok: true,
    value: undefined,
  });
  saveSetupCommand(db, { repository: 'github.com/Acme/Widgets', command: 'npm ci' });
  saveSetupCommand(db, { repository: 'github.com/acme/other', command: 'go mod download' });
  expect(findSetupCommand(db, 'github.com/acme/widgets')).toMatchObject({
    ok: true,
    value: { repository: 'github.com/acme/widgets', command: 'npm ci' },
  });
  saveSetupCommand(db, {
    repository: 'github.com/acme/widgets',
    command: 'npm ci && npm run build',
  });
  expect(findSetupCommand(db, 'GITHUB.COM/acme/widgets')).toMatchObject({
    ok: true,
    value: { command: 'npm ci && npm run build' },
  });
  expect(findSetupCommand(db, 'github.com/acme/other')).toMatchObject({
    ok: true,
    value: { command: 'go mod download' },
  });
});

test('refuses an empty command at the schema', ({ expect, db }) => {
  expect(() => {
    return saveSetupCommand(db, { repository: 'github.com/a/b', command: '' });
  }).toThrow(/CHECK/u);
});
