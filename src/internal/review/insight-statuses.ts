/** `pending` until the reviewer promotes an insight into the URA (`y`) or dismisses it (`d`). */
export const insightStatuses = ['pending', 'promoted', 'dismissed'] as const;

export type InsightStatus = (typeof insightStatuses)[number];
