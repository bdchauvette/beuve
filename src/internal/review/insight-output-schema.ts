import { z } from 'zod';

import { insightCategories } from './insight-categories.ts';
import { insightSeverities } from './insight-severities.ts';

const path = z
  .string()
  .min(1)
  .max(4096)
  .describe('Head-side path of a file in the diff, relative to the repository root.');

const lineStart = z
  .int()
  .min(1)
  .max(10_000_000)
  .describe('First head-side line (1-based) the insight is about.');

const lineEnd = z
  .int()
  .min(1)
  .max(10_000_000)
  .describe('Last head-side line, inclusive; equal to lineStart for a single line.');

const title = z.string().min(1).max(200).describe('One line, under 100 characters.');

const body = z
  .string()
  .min(1)
  .max(4000)
  .describe('Markdown: the concrete failure scenario, why it happens and what to check.');

const confidence = z
  .number()
  .min(0)
  .max(1)
  .describe('Probability that a careful reviewer would agree this is a real problem.');

const insight = z.strictObject({
  path,
  lineStart,
  lineEnd,
  severity: z.enum(insightSeverities),
  category: z.enum(insightCategories),
  title,
  body,
  confidence,
});

/**
 * What the model must return (sent to it as JSON Schema, ADR 0019); the descriptions are part of
 * its instructions. At most 50 insights; `validateInsights` keeps fewer.
 */
export const insightOutputSchema = z.strictObject({
  insights: z
    .array(insight)
    .max(50)
    .describe('Fewest, highest-value insights first; an empty list is a good answer.'),
});

/** One insight as the model returned it, before validation against the diff. */
export type ModelInsight = z.infer<typeof insightOutputSchema>['insights'][number];
