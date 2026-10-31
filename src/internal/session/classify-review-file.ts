import type { MechanicalReason } from './mechanical-reason.ts';
import { mechanicalRules } from './mechanical-rules.ts';
import type { FileFacts, MechanicalRule } from './mechanical-rules.ts';

/**
 * Why `path` is config or mechanical rather than a change to read in order (ADR 0065), or
 * `undefined` for an ordinary file. The first matching rule wins. Pure; `rules` is data.
 */
export function classifyReviewFile(
  path: string,
  facts: FileFacts,
  rules: readonly MechanicalRule[] = mechanicalRules,
): MechanicalReason | undefined {
  return rules.find((rule) => isMatch(rule, path, facts))?.reason;
}

function isMatch(rule: MechanicalRule, path: string, facts: FileFacts): boolean {
  if (rule.kind === 'path') {
    return rule.pattern.test(path);
  }
  return facts[rule.fact];
}
