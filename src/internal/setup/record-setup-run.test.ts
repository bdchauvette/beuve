import { findSetupRun } from './find-setup-run.ts';
import { forgetSetupRuns } from './forget-setup-runs.ts';
import { recordSetupRun } from './record-setup-run.ts';
import { test } from './testing/test.ts';

test('keeps the last successful run per session', ({ expect, db }) => {
  expect(findSetupRun(db, 's1')).toStrictEqual({ ok: true, value: undefined });
  recordSetupRun(db, { sessionId: 's1', headSha: 'a'.repeat(40), checkout: '/w/a' });
  recordSetupRun(db, { sessionId: 's1', headSha: 'b'.repeat(40), checkout: '/w/b' });
  recordSetupRun(db, { sessionId: 's2', headSha: 'a'.repeat(40), checkout: '/w/a' });
  expect(findSetupRun(db, 's1')).toMatchObject({
    ok: true,
    value: { sessionId: 's1', headSha: 'b'.repeat(40), checkout: '/w/b' },
  });
  expect(findSetupRun(db, 's2')).toMatchObject({ ok: true, value: { checkout: '/w/a' } });
});

test('forgets the runs of a checkout that was reset, and goes with its session', ({
  expect,
  db,
}) => {
  recordSetupRun(db, { sessionId: 's1', headSha: 'a'.repeat(40), checkout: '/w/a' });
  recordSetupRun(db, { sessionId: 's2', headSha: 'b'.repeat(40), checkout: '/w/b' });
  forgetSetupRuns(db, '/w/a');
  expect(findSetupRun(db, 's1')).toStrictEqual({ ok: true, value: undefined });
  db.prepare("DELETE FROM sessions WHERE id = 's2';").run();
  expect(findSetupRun(db, 's2')).toStrictEqual({ ok: true, value: undefined });
});
