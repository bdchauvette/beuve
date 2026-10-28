import type { TraceRules } from './trace-rules.ts';

const loop = { kind: 'loop', bodyField: 'body' } as const;
const ownArguments = { bodyField: 'body', parametersField: 'parameters', hasArguments: true };

/** Trace rules for the tree-sitter TypeScript, TSX and JavaScript grammars (ADR 0036). */
export const ecmascriptTraceRules: TraceRules = {
  functions: {
    function_declaration: ownArguments,
    generator_function_declaration: ownArguments,
    function_expression: ownArguments,
    generator_function: ownArguments,
    method_definition: ownArguments,
    arrow_function: {
      bodyField: 'body',
      parametersField: 'parameters',
      parameterField: 'parameter',
      hasArguments: false,
    },
  },
  nameField: 'name',
  namers: {
    variable_declarator: 'name',
    pair: 'key',
    public_field_definition: 'name',
    field_definition: 'property',
    assignment_expression: 'left',
  },
  scopes: ['class_declaration', 'abstract_class_declaration', 'class'],
  blocks: ['statement_block'],
  delimited: ['parenthesized_expression'],
  skipped: ['comment'],
  parameters: {
    identifiers: ['identifier'],
    wrappers: {
      required_parameter: 'pattern',
      optional_parameter: 'pattern',
      assignment_pattern: 'left',
    },
    rest: ['rest_pattern'],
    ignored: ['this'],
  },
  directive: { statement: 'expression_statement', string: 'string' },
  labels: ['labeled_statement'],
  constructs: {
    if_statement: { kind: 'if', conditionField: 'condition' },
    ternary_expression: { kind: 'ternary', conditionField: 'condition' },
    switch_statement: {
      kind: 'switch',
      valueField: 'value',
      bodyField: 'body',
      cases: { switch_case: { valueField: 'value' }, switch_default: {} },
      caseDelimiter: ':',
    },
    for_statement: loop,
    for_in_statement: loop,
    while_statement: loop,
    do_statement: loop,
    catch_clause: { kind: 'catch', parameterField: 'parameter', bodyField: 'body' },
    return_statement: { kind: 'return' },
    throw_statement: { kind: 'throw' },
  },
};
