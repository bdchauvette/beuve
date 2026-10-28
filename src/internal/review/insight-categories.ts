/** What kind of risk an insight describes. */
export const insightCategories = [
  'edge-case',
  'security',
  'type-mismatch',
  'error-handling',
  'concurrency',
  'scope-creep',
  'complexity',
  'other',
] as const;

export type InsightCategory = (typeof insightCategories)[number];
