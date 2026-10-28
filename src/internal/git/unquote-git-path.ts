const escapes: ReadonlyMap<string, number> = new Map([
  ['a', 0x07],
  ['b', 0x08],
  ['t', 0x09],
  ['n', 0x0a],
  ['v', 0x0b],
  ['f', 0x0c],
  ['r', 0x0d],
  ['"', 0x22],
  ['\\', 0x5c],
]);
const octalPattern = /^[0-3][0-7]{2}/u;

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

/**
 * Decodes a path as git prints it: unchanged when bare, or C-quoted (`"tab\there"`, octal bytes
 * like `\303\274`) when it contains special characters. `undefined` if the quoting is malformed.
 */
export function unquoteGitPath(text: string): string | undefined {
  if (!text.startsWith('"')) {
    return text;
  }
  if (text.length < 2 || !text.endsWith('"')) {
    return undefined;
  }
  const body = text.slice(1, -1);
  const bytes: number[] = [];
  let index = 0;
  while (index < body.length) {
    const backslash = body.indexOf('\\', index);
    const literal = body.slice(index, backslash === -1 ? body.length : backslash);
    if (literal.includes('"')) {
      return undefined;
    }
    bytes.push(...encoder.encode(literal));
    if (backslash === -1) {
      break;
    }
    const octal = octalPattern.exec(body.slice(backslash + 1, backslash + 4));
    const escaped = octal === null ? escapes.get(body.charAt(backslash + 1)) : undefined;
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      index = backslash + 4;
    } else if (escaped === undefined) {
      return undefined;
    } else {
      bytes.push(escaped);
      index = backslash + 2;
    }
  }
  return decoder.decode(new Uint8Array(bytes));
}
