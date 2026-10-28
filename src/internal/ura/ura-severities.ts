/**
 * How much a URA item matters, most urgent first. `blocker` must be fixed before merging, `issue`
 * should be fixed, `question` needs an answer rather than a change, `nit` is optional polish and
 * `praise` asks for nothing.
 */
export const uraSeverities = ['blocker', 'issue', 'question', 'nit', 'praise'] as const;

export type UraSeverity = (typeof uraSeverities)[number];
