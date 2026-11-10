import type { UraItemView } from '#contract/ipc-contract.ts';

/** A staged human note on `src/a.ts:3-4`, current on the head, with any field overridden. */
export function createUraItemView(overrides: Partial<UraItemView> = {}): UraItemView {
  const anchor = overrides.anchor ?? {
    kind: 'lines',
    path: 'src/a.ts',
    startLine: 3,
    endLine: 4,
  };
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: '11111111-1111-4111-8111-111111111111',
    headSha: 'a'.repeat(40),
    anchor,
    placement: { kind: 'current', anchor },
    severity: 'issue',
    blocking: false,
    origin: { kind: 'human' },
    title: 'Handle the empty list',
    body: '',
    status: { kind: 'staged' },
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}
