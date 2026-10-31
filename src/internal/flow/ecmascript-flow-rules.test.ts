import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ecmascriptFlowRules } from './ecmascript-flow-rules.ts';
import { loadTestLanguage } from './testing/load-test-language.ts';

describe('ecmascriptFlowRules', () => {
  test('names only node types and fields the grammars have', async ({ expect }) => {
    const rules = ecmascriptFlowRules;
    const grammars = await Promise.all(
      (['typescript', 'tsx', 'javascript'] as const).map(async (language) => {
        return loadTestLanguage(language);
      }),
    );
    const types = [
      ...rules.functions,
      ...Object.keys(rules.namers),
      ...rules.blocks,
      ...rules.skipped,
      ...rules.transparent,
      ...Object.keys(rules.statements),
    ];
    const fields = [rules.bodyField, rules.nameField, ...Object.values(rules.namers)];
    for (const rule of Object.values(rules.statements)) {
      const named = Object.entries(rule).filter((entry): entry is [string, string] => {
        return typeof entry[1] === 'string';
      });
      fields.push(...named.filter(([key]) => key.endsWith('Field')).map(([, value]) => value));
      types.push(
        ...named.filter(([key]) => key === 'alternativeWrapper').map(([, value]) => value),
      );
      if (rule.kind !== 'switch') {
        continue;
      }

      types.push(...Object.keys(rule.cases));
      fields.push(...Object.values(rule.cases).map((item) => item.valueField ?? 'value'));
    }
    const missingTypes = types.filter((type) => {
      return grammars.every((grammar) => !grammar.types.has(type));
    });
    const missingFields = fields.filter((field) => {
      return grammars.every((grammar) => !grammar.fields.has(field));
    });

    expect(missingTypes).toStrictEqual([]);
    expect(missingFields).toStrictEqual([]);
  });
});
