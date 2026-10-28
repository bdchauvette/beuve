import type { LanguageRules } from './language-rules.ts';

const functionBody = { bodyField: 'body', parametersField: 'parameters' } as const;
const method = { ...functionBody, nameField: 'name', nameModifiers: ['get', 'set'] } as const;
const loop = { kind: 'branch', decision: true, nestedFields: ['body'] } as const;

/**
 * Rules for the tree-sitter TypeScript, TSX and JavaScript grammars (ADR 0015). Types that only
 * one grammar has (`public_field_definition` vs `field_definition`) are simply never seen by the other.
 */
export const ecmascriptRules: LanguageRules = {
  functions: {
    function_declaration: { ...functionBody, nameField: 'name' },
    generator_function_declaration: { ...functionBody, nameField: 'name' },
    function_expression: { ...functionBody, nameField: 'name' },
    generator_function: { ...functionBody, nameField: 'name' },
    arrow_function: { ...functionBody, parameterField: 'parameter' },
    method_definition: method,
  },
  scopes: {
    class_declaration: { nameField: 'name' },
    abstract_class_declaration: { nameField: 'name' },
    class: { nameField: 'name' },
    internal_module: { nameField: 'name' },
    module: { nameField: 'name' },
    object: {},
  },
  namers: {
    variable_declarator: { kind: 'field', nameField: 'name', valueField: 'value' },
    assignment_expression: { kind: 'field', nameField: 'left', valueField: 'right' },
    pair: { kind: 'field', nameField: 'key', valueField: 'value' },
    public_field_definition: { kind: 'field', nameField: 'name', valueField: 'value' },
    field_definition: { kind: 'field', nameField: 'property', valueField: 'value' },
    export_statement: { kind: 'fixed', name: 'default', valueField: 'value' },
    call_expression: {
      kind: 'call',
      calleeField: 'function',
      argumentsField: 'arguments',
      labelTypes: ['string', 'template_string'],
    },
  },
  constructs: {
    if_statement: { kind: 'branch', decision: true, nestedFields: ['consequence'] },
    else_clause: { kind: 'else', continues: 'if_statement' },
    switch_statement: { kind: 'branch', decision: false, nestedFields: ['body'] },
    switch_case: { kind: 'case', valueField: 'value' },
    for_statement: loop,
    for_in_statement: loop,
    while_statement: loop,
    do_statement: loop,
    catch_clause: { kind: 'branch', decision: true, nestedFields: ['body'] },
    ternary_expression: {
      kind: 'branch',
      decision: true,
      nestedFields: ['consequence', 'alternative'],
    },
    binary_expression: {
      kind: 'logical',
      operatorField: 'operator',
      operators: ['&&', '||', '??'],
    },
    break_statement: { kind: 'jump', labelField: 'label' },
    continue_statement: { kind: 'jump', labelField: 'label' },
    call_expression: {
      kind: 'call',
      calleeField: 'function',
      objectField: 'object',
      propertyField: 'property',
      selfTypes: ['this'],
    },
  },
  transparent: ['parenthesized_expression'],
};
