import { z } from 'zod';

import type { TrustScope } from './trust-scope.ts';

const repositoryScope = z.strictObject({
  kind: z.literal('repository'),
  path: z.string().min(1).max(4096),
  remoteUrl: z.string().min(1).max(4096).optional(),
});

/**
 * A stored scope from its JSON text, or `undefined` when it isn't one this version knows: a
 * malformed row, or a kind a newer beuve added. Such a grant matches nothing (ADR 0090).
 */
export function parseTrustScope(text: string): TrustScope | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = repositoryScope.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  const { path, remoteUrl } = parsed.data;
  return { kind: 'repository', path, ...(remoteUrl !== undefined && { remoteUrl }) };
}
