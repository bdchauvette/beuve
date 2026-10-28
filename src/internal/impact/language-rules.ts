/**
 * How to read one grammar's trees (ADR 0015). Every key is a node type and every `…Field` a field
 * name of that grammar; a new language is a new table, not new code.
 */
export interface LanguageRules {
  /** Nodes measured as functions of their own. Nested functions are separate entries. */
  readonly functions: Readonly<Record<string, FunctionRule>>;
  /** Nodes that add a segment to the qualified names inside them (classes, namespaces, objects). */
  readonly scopes: Readonly<Record<string, ScopeRule>>;
  /** Parents that name an anonymous function or scope in one of their fields. */
  readonly namers: Readonly<Record<string, NamerRule>>;
  /** Control flow and operators that count towards complexity. */
  readonly constructs: Readonly<Record<string, ConstructRule>>;
  /** Nodes a sequence of boolean operators passes through unbroken (parentheses). */
  readonly transparent: readonly string[];
}

export interface FunctionRule {
  /** Field holding the function's own name, if it can have one. */
  readonly nameField?: string;
  /** Field holding the body; its text identifies a renamed function. */
  readonly bodyField: string;
  /** Field holding a parameter list (counted by named children) … */
  readonly parametersField: string;
  /** … or a single bare parameter (`x => x`). */
  readonly parameterField?: string;
  /** Unnamed children whose type prefixes the name (`get value` vs `set value`). */
  readonly nameModifiers?: readonly string[];
}

export interface ScopeRule {
  /** Field holding the scope's own name; otherwise a namer parent's, or `<anonymous>`. */
  readonly nameField?: string;
}

export type NamerRule =
  /** `const name = <value>`, `{ name: <value> }`, `name = <value>`. */
  | { readonly kind: 'field'; readonly nameField: string; readonly valueField: string }
  /** `export default <value>`. */
  | { readonly kind: 'fixed'; readonly name: string; readonly valueField: string }
  /**
   * `it('does x', <argument>)` names a function argument `it('does x')`: the callee and the first
   * argument of a `labelTypes` type, or `…` when there is none.
   */
  | {
      readonly kind: 'call';
      readonly calleeField: string;
      readonly argumentsField: string;
      readonly labelTypes: readonly string[];
    };

/**
 * - `branch`: a break in linear flow that nests (if, loops, switch, catch, ternary). Cognitive +1
 *   plus the nesting level; `nestedFields` are one level deeper. `decision` adds 1 to cyclomatic.
 * - `else`: cognitive +1 without a nesting increment. A `continues` child (`else if`) continues
 *   the chain at the same level and counts for cyclomatic only.
 * - `case`: a switch case with a `valueField`; cyclomatic +1.
 * - `logical`: cyclomatic +1 per operator; cognitive +1 per run of like operators in a sequence.
 * - `jump`: a jump to a label (`break label`): cognitive +1.
 * - `call`: a call whose callee names the enclosing function adds cognitive +1 (recursion), once.
 *   `selfTypes` are receiver nodes (`this`) of a member callee (`objectField.propertyField`).
 */
export type ConstructRule =
  | {
      readonly kind: 'branch';
      readonly decision: boolean;
      readonly nestedFields: readonly string[];
    }
  | { readonly kind: 'else'; readonly continues: string }
  | { readonly kind: 'case'; readonly valueField: string }
  | {
      readonly kind: 'logical';
      readonly operatorField: string;
      readonly operators: readonly string[];
    }
  | { readonly kind: 'jump'; readonly labelField: string }
  | {
      readonly kind: 'call';
      readonly calleeField: string;
      readonly objectField: string;
      readonly propertyField: string;
      readonly selfTypes: readonly string[];
    };
