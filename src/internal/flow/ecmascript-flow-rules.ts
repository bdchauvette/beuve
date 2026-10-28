import type { FlowRules } from './flow-rules.ts';

const loop = { kind: 'loop', form: 'pre', bodyField: 'body' } as const;

/** Flow rules for the tree-sitter TypeScript, TSX and JavaScript grammars (ADR 0028). */
export const ecmascriptFlowRules: FlowRules = {
  functions: [
    'function_declaration',
    'generator_function_declaration',
    'function_expression',
    'generator_function',
    'arrow_function',
    'method_definition',
  ],
  bodyField: 'body',
  nameField: 'name',
  namers: {
    variable_declarator: 'name',
    pair: 'key',
    public_field_definition: 'name',
    field_definition: 'property',
    assignment_expression: 'left',
  },
  blocks: ['statement_block'],
  skipped: ['comment', 'empty_statement'],
  transparent: ['parenthesized_expression'],
  statements: {
    if_statement: {
      kind: 'if',
      conditionField: 'condition',
      consequenceField: 'consequence',
      alternativeField: 'alternative',
      alternativeWrapper: 'else_clause',
    },
    for_statement: loop,
    for_in_statement: loop,
    while_statement: loop,
    do_statement: { kind: 'loop', form: 'post', bodyField: 'body', conditionField: 'condition' },
    switch_statement: {
      kind: 'switch',
      bodyField: 'body',
      cases: { switch_case: { valueField: 'value' }, switch_default: {} },
    },
    try_statement: {
      kind: 'try',
      bodyField: 'body',
      handlerField: 'handler',
      finalizerField: 'finalizer',
      clauseBodyField: 'body',
    },
    return_statement: { kind: 'return' },
    throw_statement: { kind: 'throw' },
    break_statement: { kind: 'break', labelField: 'label' },
    continue_statement: { kind: 'continue', labelField: 'label' },
    labeled_statement: { kind: 'labeled', labelField: 'label', bodyField: 'body' },
  },
};
