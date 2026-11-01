import { describe } from 'vitest';

import { deleteTrustGrant } from './delete-trust-grant.ts';
import { findTrustGrant } from './find-trust-grant.ts';
import { listTrustGrants } from './list-trust-grants.ts';
import { saveTrustGrant } from './save-trust-grant.ts';
import { test } from './testing/test.ts';

describe('trust grants in the database (ADR 0090)', () => {
  test('stores one grant per scope, replaced by a second grant, and deletes it', ({
    expect,
    db,
  }) => {
    saveTrustGrant(db, {
      scope: { kind: 'repository', path: '/r', remoteUrl: 'a' },
      grantedAt: '2026-11-01T00:00:00.000Z',
    });
    saveTrustGrant(db, {
      scope: { kind: 'repository', path: '/r' },
      grantedAt: '2026-11-01T01:00:00.000Z',
    });
    expect(listTrustGrants(db)).toStrictEqual([
      { scope: { kind: 'repository', path: '/r' }, grantedAt: '2026-11-01T01:00:00.000Z' },
    ]);
    expect(deleteTrustGrant(db, { kind: 'repository', key: '/r' })).toBe(1);
    expect(deleteTrustGrant(db, { kind: 'repository', key: '/r' })).toBe(0);
    expect(listTrustGrants(db)).toStrictEqual([]);
  });

  test('a scope kind this version does not know is kept but matches nothing', ({ expect, db }) => {
    db.prepare(
      `INSERT INTO trust_grants (kind, scope_key, scope, granted_at) VALUES ('branch', ?, ?, 'now');`,
    ).run('/r:main', JSON.stringify({ kind: 'branch', path: '/r', branch: 'main' }));
    expect(listTrustGrants(db)).toStrictEqual([]);
    expect(
      findTrustGrant(listTrustGrants(db), { repositoryPath: '/r', remoteUrl: undefined }),
    ).toBeUndefined();
    expect({ ...db.prepare('SELECT count(*) AS n FROM trust_grants;').get() }).toStrictEqual({
      n: 1,
    });
  });
});
