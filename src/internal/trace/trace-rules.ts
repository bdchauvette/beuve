/**
 * How to instrument one grammar's functions (ADR 0036). Every key is a node type and every
 * `…Field` a field name of that grammar; a new language is a new table, not new code.
 */
export interface TraceRules {
  /** Node types that are functions, with where their parts live. */
  readonly functions: Readonly<Record<string, FunctionRule>>;
  /** Field holding a function's own name. */
  readonly nameField: string;
  /** Parent types that name an anonymous function (`const f = () => …`), by name field. */
  readonly namers: Readonly<Record<string, string>>;
  /** Enclosing types whose `nameField` qualifies a function name (`Class.method`). */
  readonly scopes: readonly string[];
  /** Node types that group statements (`{ … }`); a function body of another type is an expression. */
  readonly blocks: readonly string[];
  /** Node types with outer delimiters to instrument inside (`if (…)`). */
  readonly delimited: readonly string[];
  /** Node types that carry nothing (comments). */
  readonly skipped: readonly string[];
  readonly parameters: ParameterRules;
  /** A statement type whose `string` child at the start of a body is a directive (`'use strict'`). */
  readonly directive: { readonly statement: string; readonly string: string };
  /** Wrappers that name a statement (`outer: for …`); a loop is wrapped together with its labels. */
  readonly labels: readonly string[];
  readonly constructs: Readonly<Record<string, ConstructRule>>;
}

export interface FunctionRule {
  readonly bodyField: string;
  /** Field holding the parameter list. */
  readonly parametersField?: string;
  /** Field holding a lone parameter written without parentheses (`x => …`). */
  readonly parameterField?: string;
  /** The function has its own `arguments`, so destructured parameters can still be summarized. */
  readonly hasArguments: boolean;
}

export interface ParameterRules {
  /** Node types that are a plain parameter name. */
  readonly identifiers: readonly string[];
  /** Wrapper types and the field holding what they wrap (`required_parameter` → `pattern`). */
  readonly wrappers: Readonly<Record<string, string>>;
  /** Rest parameter types (`...rest`); their identifier is a named child. */
  readonly rest: readonly string[];
  /** Parameter node types that are not values (`this` in TypeScript). */
  readonly ignored: readonly string[];
}

/**
 * - `if` and `ternary`: the condition is recorded as taken or not.
 * - `switch`: the discriminant value is recorded, and every case and default records its entry.
 *   A case is a child of the body field; one without `valueField` is the default.
 * - `loop`: one event per loop run, counting iterations of its body field.
 * - `catch`: entering the clause records the caught value (the parameter, when it is a name).
 * - `return` and `throw`: the value is recorded; the expression is the statement's named child.
 */
export type ConstructRule =
  | { readonly kind: 'if'; readonly conditionField: string }
  | { readonly kind: 'ternary'; readonly conditionField: string }
  | {
      readonly kind: 'switch';
      readonly valueField: string;
      readonly bodyField: string;
      readonly cases: Readonly<Record<string, { readonly valueField?: string }>>;
      /** The token ending a case label (`:`). */
      readonly caseDelimiter: string;
    }
  | { readonly kind: 'loop'; readonly bodyField: string }
  | { readonly kind: 'catch'; readonly parameterField: string; readonly bodyField: string }
  | { readonly kind: 'return' }
  | { readonly kind: 'throw' };
