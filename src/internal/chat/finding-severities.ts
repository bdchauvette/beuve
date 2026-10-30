/** How much a review finding should worry the reviewer, mildest first. */
export const findingSeverities = ['info', 'warning', 'risk'] as const;

export type FindingSeverity = (typeof findingSeverities)[number];
