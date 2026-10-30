import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ecmascriptTraceRules } from './ecmascript-trace-rules.ts';
import { loadTestLanguage } from './testing/load-test-language.ts';

describe('ecmascriptTraceRules', () => {
  test('names only node types and fields the grammars have', async ({ expect }) => {
    const rules = ecmascriptTraceRules;
    const grammars = await Promise.all(
      (['typescript', 'tsx', 'javascript'] as const).map(async (language) =>
        loadTestLanguage(language),
      ),
    );
    const types = [
      ...Object.keys(rules.functions),
      ...Object.keys(rules.namers),
      ...rules.scopes,
      ...rules.blocks,
      ...rules.delimited,
      ...rules.skipped,
      ...rules.parameters.identifiers,
      ...Object.keys(rules.parameters.wrappers),
      ...rules.parameters.rest,
      ...rules.parameters.ignored,
      rules.directive.statement,
      rules.directive.string,
      ...rules.labels,
      ...Object.keys(rules.constructs),
    ];
    const fields = [
      rules.nameField,
      ...Object.values(rules.namers),
      ...Object.values(rules.parameters.wrappers),
      ...Object.values(rules.functions).flatMap((rule) => [
        rule.bodyField,
        ...(rule.parametersField === undefined ? [] : [rule.parametersField]),
        ...(rule.parameterField === undefined ? [] : [rule.parameterField]),
      ]),
    ];
    for (const rule of Object.values(rules.constructs)) {
      fields.push(
        ...Object.entries(rule)
          .filter((entry): entry is [string, string] => entry[0].endsWith('Field'))
          .map(([, value]) => value),
      );
      if (rule.kind !== 'switch') {
        continue;
      }

      types.push(...Object.keys(rule.cases), rule.caseDelimiter);
      fields.push(...Object.values(rule.cases).flatMap((item) => item.valueField ?? []));
    }
    const missingTypes = types.filter((type) =>
      grammars.every((grammar) => !grammar.types.has(type)),
    );
    const missingFields = fields.filter((field) =>
      grammars.every((grammar) => !grammar.fields.has(field)),
    );
    expect({ missingTypes, missingFields }).toStrictEqual({ missingTypes: [], missingFields: [] });
  });
});
