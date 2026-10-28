/** What a summarized runtime value was. */
export type ValueType =
  | 'undefined'
  | 'null'
  | 'boolean'
  | 'number'
  | 'bigint'
  | 'string'
  | 'symbol'
  | 'function'
  | 'array'
  | 'object'
  | 'map'
  | 'set'
  | 'date'
  | 'regexp'
  | 'error'
  | 'promise'
  | 'binary'
  | 'proxy'
  | 'unavailable';

/**
 * A bounded, display-ready rendering of a runtime value (ADR 0036), made without running any of
 * the program's code: no getters, `toString`, `toJSON` or proxy traps. `preview` is one line.
 */
export interface ValueSummary {
  readonly type: ValueType;
  readonly preview: string;
}
