import { z } from 'zod';

import type { QueueFiltersView, ReviewQueuePrefsView } from '#contract/ipc-contract.ts';

const names = z.array(z.string().min(1).max(200)).max(50);

const filtersSchema = z.strictObject({
  kinds: z.array(z.enum(['pull-request', 'branch'])).max(2),
  repositories: names,
  authors: names,
  request: z.enum(['any', 'direct', 'team']),
  hideDrafts: z.boolean(),
  ci: z.array(z.enum(['failure', 'pending', 'success'])).max(3),
  turns: z.array(z.enum(['you', 'author', 'reviewers', 'unknown'])).max(4),
  local: z.array(z.enum(['none', 'opened', 'partial', 'reviewed', 'new-commits'])).max(5),
  showWaitingOnOthers: z.boolean(),
}) satisfies z.ZodType<QueueFiltersView>;

/**
 * The review queue's preferences (ADR 0113) as `settings.json` keeps them and `display:set`
 * takes them: a sort, a grouping and the filters, all of them.
 */
export const reviewQueuePrefsSchema = z.strictObject({
  sort: z.enum([
    'turn',
    'waiting',
    'oldest',
    'updated',
    'smallest',
    'largest',
    'stack',
    'new-since-review',
  ]),
  group: z.enum(['none', 'repository', 'stack', 'turn', 'kind', 'local']),
  filters: filtersSchema,
}) satisfies z.ZodType<ReviewQueuePrefsView>;
