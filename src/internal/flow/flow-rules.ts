/**
 * How to read one grammar's trees as control flow (ADR 0028). Every key is a node type and every
 * `…Field` a field name of that grammar; a new language is a new table, not new code.
 */
export interface FlowRules {
  /** Node types that are functions. Their bodies are not entered from an enclosing function. */
  readonly functions: readonly string[];
  readonly bodyField: string;
  /** Field holding a function's own name. */
  readonly nameField: string;
  /** Parent types that name an anonymous function (`const f = () => …`), by name field. */
  readonly namers: Readonly<Record<string, string>>;
  /** Node types that only group statements (`{ … }`). */
  readonly blocks: readonly string[];
  /** Node types that carry no flow (comments, empty statements). */
  readonly skipped: readonly string[];
  /** Node types whose outer delimiters are dropped from condition labels (parentheses). */
  readonly transparent: readonly string[];
  /** Statement types that shape control flow; every other statement is straight-line code. */
  readonly statements: Readonly<Record<string, StatementRule>>;
}

/**
 * - `if`: a condition with `true` and `false` branches; `alternativeWrapper` is the node around an
 *   `else` body (its last named child is the statement).
 * - `loop`: `pre` loops test before the body (`while`, `for`), `post` loops after (`do … while`).
 * - `switch`: cases are children of the body field; a case without `valueField` is the default.
 * - `try`: optional handler (catch) and finalizer (finally) clauses, each with its own body field.
 * - `break` and `continue` may name a label; `labeled` wraps a statement in one.
 */
export type StatementRule =
  | {
      readonly kind: 'if';
      readonly conditionField: string;
      readonly consequenceField: string;
      readonly alternativeField: string;
      readonly alternativeWrapper: string;
    }
  | {
      readonly kind: 'loop';
      readonly form: 'pre' | 'post';
      readonly bodyField: string;
      /** Condition of a `post` loop. */
      readonly conditionField?: string;
    }
  | {
      readonly kind: 'switch';
      readonly bodyField: string;
      readonly cases: Readonly<Record<string, CaseRule>>;
    }
  | {
      readonly kind: 'try';
      readonly bodyField: string;
      readonly handlerField: string;
      readonly finalizerField: string;
      /** Field of the catch and finally clauses holding their block. */
      readonly clauseBodyField: string;
    }
  | { readonly kind: 'return' }
  | { readonly kind: 'throw' }
  | { readonly kind: 'break'; readonly labelField: string }
  | { readonly kind: 'continue'; readonly labelField: string }
  | { readonly kind: 'labeled'; readonly labelField: string; readonly bodyField: string };

export interface CaseRule {
  /** Field holding the case's test value; absent for `default`. */
  readonly valueField?: string;
}
