/** How much an insight should worry the reviewer, mildest first. */
export const insightSeverities = ['info', 'warning', 'risk'] as const;

export type InsightSeverity = (typeof insightSeverities)[number];
