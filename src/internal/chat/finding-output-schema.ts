import { z } from 'zod';

import { findingCategories } from './finding-categories.ts';
import { findingSeverities } from './finding-severities.ts';

const path = z
  .string()
  .min(1)
  .max(4096)
  .describe('Head-side path of a file in the diff, relative to the repository root.');

const startLine = z
  .int()
  .min(1)
  .max(10_000_000)
  .describe('First head-side line (1-based) the finding is about.');

const endLine = z
  .int()
  .min(1)
  .max(10_000_000)
  .describe('Last head-side line, inclusive; equal to startLine for a single line.');

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

const finding = z.strictObject({
  path,
  startLine,
  endLine,
  severity: z.enum(findingSeverities),
  category: z.enum(findingCategories),
  title,
  body,
  confidence,
});

/**
 * What `/review` must return (sent to the model as JSON Schema, ADR 0019, 0055); the descriptions
 * are part of its instructions. At most 50 findings; `validateFindings` keeps fewer.
 */
export const findingOutputSchema = z.strictObject({
  findings: z
    .array(finding)
    .max(50)
    .describe('Fewest, highest-value findings first; an empty list is a good answer.'),
});

/** One finding as the model returned it, before validation against the diff. */
export type ModelFinding = z.infer<typeof findingOutputSchema>['findings'][number];
