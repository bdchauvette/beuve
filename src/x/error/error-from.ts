const maxDescriptionLength = 200;
const maxListedKeys = 5;
const endsWithHighSurrogate = /[\uD800-\uDBFF]$/u;

/**
 * A real `Error` for anything a `catch` or a rejected promise hands over. An error, from this
 * realm or another (`Error.isError`), is returned as it is, never rewrapped. Anything else becomes
 * a new `Error` with the value as its `cause` and the message `Non-error thrown: <description>`:
 *
 * - a string is quoted (`Non-error thrown: "boom"`);
 * - `undefined`, `null`, numbers, booleans, bigints and symbols print as `String` does;
 * - a function is `function name`;
 * - an object is its constructor's name (`Object` when it has none, as with a null prototype),
 *   then its own string `message` if it has one (`Object with message "boom"`), else its first
 *   own keys (`Object with keys code, path`).
 *
 * The description never calls the value's own `toString`, `toJSON` or `Symbol.toPrimitive`, is cut
 * to 200 characters and cannot throw, even for a revoked `Proxy` or a getter that throws.
 */
export function errorFrom(value: unknown): Error {
  return Error.isError(value)
    ? value
    : new Error(`Non-error thrown: ${describe(value)}`, { cause: value });
}

function describe(value: unknown): string {
  try {
    return truncated(describeUnsafely(value));
  } catch {
    return 'an unprintable value';
  }
}

function describeUnsafely(value: unknown): string {
  switch (typeof value) {
    case 'string': {
      return quoted(value);
    }
    case 'function': {
      return `function ${nameOf(value, 'anonymous')}`;
    }
    case 'object': {
      return value === null ? 'null' : describeObject(value);
    }
    default: {
      return String(value);
    }
  }
}

function describeObject(value: object): string {
  const name = nameOf(Reflect.get(value, 'constructor'));
  const message = Object.getOwnPropertyDescriptor(value, 'message')?.value as unknown;
  if (typeof message === 'string') {
    return `${name} with message ${quoted(message)}`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return name;
  }
  const listed = keys.slice(0, maxListedKeys).join(', ');
  return `${name} with keys ${listed}${keys.length > maxListedKeys ? ', …' : ''}`;
}

function nameOf(named: unknown, fallback = 'Object'): string {
  const name =
    typeof named === 'function'
      ? (Object.getOwnPropertyDescriptor(named, 'name')?.value as unknown)
      : undefined;
  return typeof name === 'string' && name !== '' ? name : fallback;
}

function quoted(text: string): string {
  return JSON.stringify(truncated(text));
}

function truncated(text: string): string {
  if (text.length <= maxDescriptionLength) {
    return text;
  }
  const head = text.slice(0, maxDescriptionLength);
  return `${endsWithHighSurrogate.test(head) ? head.slice(0, -1) : head}…`;
}
