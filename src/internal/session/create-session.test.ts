import { describe, expect, it } from 'vitest';

import { createSession } from './create-session.ts';
import { isUuid } from '#x/text/is-uuid.ts';
import type { CommitSha, SessionDeps } from './session.ts';

const head = 'a'.repeat(40) as CommitSha;
const deps: SessionDeps = {
  now: (): Date => new Date('2026-10-28T12:00:00Z'),
  newId: (): string => '00000000-0000-4000-8000-000000000001',
};

describe('createSession', () => {
  it('starts unreviewed at the given head', () => {
    const source = {
      kind: 'local',
      repoPath: '/repo',
      baseRef: 'main',
      headRef: 'feature',
    } as const;
    expect(createSession(source, head, deps)).toEqual({
      ok: true,
      value: {
        id: '00000000-0000-4000-8000-000000000001',
        source,
        headSha: head,
        review: { kind: 'unreviewed' },
        createdAt: '2026-10-28T12:00:00.000Z',
        updatedAt: '2026-10-28T12:00:00.000Z',
      },
    });
  });

  it('rejects an invalid source', () => {
    const source = { kind: 'local', repoPath: 'repo', baseRef: 'main', headRef: 'x' } as const;
    expect(createSession(source, head, deps)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-source' },
    });
  });

  it('uses the system clock and randomUUID by default', () => {
    const source = { kind: 'local', repoPath: '/repo', baseRef: 'main', headRef: 'x' } as const;
    const created = createSession(source, head);
    expect(created.ok && isUuid(created.value.id)).toBe(true);
  });
});
