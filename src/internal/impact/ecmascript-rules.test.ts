import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ecmascriptRules } from './ecmascript-rules.ts';
import type { ConstructRule, LanguageRules, NamerRule } from './language-rules.ts';
import { loadTestLanguage } from './testing/load-test-language.ts';

describe('ecmascriptRules', () => {
  test('names only node types and fields the grammars have', async ({ expect }) => {
    const grammars = await Promise.all(
      (['typescript', 'tsx', 'javascript'] as const).map(async (language) =>
        loadTestLanguage(language),
      ),
    );
    const { types, fields } = referenced(ecmascriptRules);
    const missingTypes = types.filter((type) =>
      grammars.every((grammar) => !grammar.types.has(type)),
    );
    const missingFields = fields.filter((field) =>
      grammars.every((grammar) => !grammar.fields.has(field)),
    );
    const grammarSpecific = types.filter((type) =>
      grammars.some((grammar) => !grammar.types.has(type)),
    );

    expect(missingTypes).toStrictEqual([]);
    expect(missingFields).toStrictEqual([]);
    expect(grammarSpecific.toSorted((left, right) => left.localeCompare(right))).toStrictEqual([
      'abstract_class_declaration',
      'field_definition',
      'internal_module',
      'module',
      'public_field_definition',
    ]);
  });
});

function referenced(rules: LanguageRules): { types: string[]; fields: string[] } {
  const types = [
    ...Object.keys(rules.functions),
    ...Object.keys(rules.scopes),
    ...Object.keys(rules.namers),
    ...Object.keys(rules.constructs),
    ...rules.transparent,
  ];
  const fields: (string | undefined)[] = [];
  for (const rule of Object.values(rules.functions)) {
    fields.push(rule.bodyField, rule.parametersField, rule.nameField, rule.parameterField);
    types.push(...(rule.nameModifiers ?? []));
  }
  for (const rule of Object.values(rules.scopes)) {
    fields.push(rule.nameField);
  }
  for (const rule of Object.values(rules.namers)) {
    const named = namerReferences(rule);
    types.push(...named.types);
    fields.push(...named.fields);
  }
  for (const rule of Object.values(rules.constructs)) {
    const constructed = constructReferences(rule);
    types.push(...constructed.types);
    fields.push(...constructed.fields);
  }
  return {
    types: [...new Set(types)],
    fields: [...new Set(fields.filter((field) => field !== undefined))],
  };
}

interface References {
  readonly types: readonly string[];
  readonly fields: readonly string[];
}

function namerReferences(rule: NamerRule): References {
  switch (rule.kind) {
    case 'field': {
      return { types: [], fields: [rule.nameField, rule.valueField] };
    }
    case 'fixed': {
      return { types: [], fields: [rule.valueField] };
    }
    case 'call': {
      return { types: rule.labelTypes, fields: [rule.calleeField, rule.argumentsField] };
    }
  }
}

function constructReferences(rule: ConstructRule): References {
  switch (rule.kind) {
    case 'branch': {
      return { types: [], fields: rule.nestedFields };
    }
    case 'else': {
      return { types: [rule.continues], fields: [] };
    }
    case 'case': {
      return { types: [], fields: [rule.valueField] };
    }
    case 'logical': {
      return { types: rule.operators, fields: [rule.operatorField] };
    }
    case 'jump': {
      return { types: [], fields: [rule.labelField] };
    }
    case 'call': {
      return {
        types: rule.selfTypes,
        fields: [rule.calleeField, rule.objectField, rule.propertyField],
      };
    }
  }
}
