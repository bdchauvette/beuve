/** What kind of risk a review finding describes. */
export const findingCategories = [
  'edge-case',
  'security',
  'type-mismatch',
  'error-handling',
  'concurrency',
  'scope-creep',
  'complexity',
  'other',
] as const;

export type FindingCategory = (typeof findingCategories)[number];
