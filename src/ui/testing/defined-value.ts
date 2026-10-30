/** `value` unless it is `undefined`, which fails the test: narrows a lookup a fixture guarantees. */
export function definedValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('expected a value, got undefined');
  }
  return value;
}
