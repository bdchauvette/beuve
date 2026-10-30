import { z } from 'zod';

const verdict = z.strictObject({
  finding: z.int().min(1).max(100).describe('The number of the finding, as listed in the prompt.'),
  verdict: z
    .enum(['confirmed', 'refuted', 'unsure'])
    .describe(
      'confirmed: the code at the cited lines has the problem as described; refuted: the code ' +
        'shows it does not (handled elsewhere, impossible input, misread code); unsure: neither.',
    ),
  reason: z.string().max(400).describe('One sentence: what in the code decided it.'),
});

/** What the `/review` verification pass returns (ADR 0055): one verdict per numbered finding. */
export const verdictOutputSchema = z.strictObject({
  verdicts: z.array(verdict).max(100),
});

/** One verdict as the model returned it. */
export type ModelVerdict = z.infer<typeof verdictOutputSchema>['verdicts'][number];
