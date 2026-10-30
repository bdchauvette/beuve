/** What module resolution needs from a `package.json` or `tsconfig.json`. */
export interface ModuleConfig {
  /** `package.json` `imports` (`#alias` → target), as parsed JSON. */
  readonly imports?: Readonly<Record<string, unknown>>;
  /** `tsconfig.json` `compilerOptions.baseUrl`. */
  readonly baseUrl?: string;
  /** `tsconfig.json` `compilerOptions.paths`: pattern → targets. */
  readonly paths?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Reads the module-resolution settings out of a `package.json` or `tsconfig.json` text (the
 * latter may hold comments and trailing commas). Malformed text, or settings of the wrong shape,
 * read as empty.
 */
export function parseModuleConfig(text: string): ModuleConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch {
    return {};
  }
  if (!isRecord(parsed)) {
    return {};
  }
  const { imports, compilerOptions } = parsed;
  const options = isRecord(compilerOptions) ? compilerOptions : {};
  const { baseUrl, paths } = options;
  return {
    ...(isRecord(imports) && { imports }),
    ...(typeof baseUrl === 'string' && { baseUrl }),
    ...(isRecord(paths) && { paths: stringListsFrom(paths) }),
  };
}

function stringListsFrom(record: Readonly<Record<string, unknown>>): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      lists[key] = value.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return lists;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Removes `//` and block comments and trailing commas outside strings. */
function stripJsonComments(text: string): string {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (char === '"') {
      const end = endOfString(text, index);
      output += text.slice(index, end);
      index = end;
    } else if (char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output.replaceAll(trailingComma, '$1');
}

const trailingComma = /,(\s*[\]}])/gu;

function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text.charAt(index) !== '"') {
    index += text.charAt(index) === '\\' ? 2 : 1;
  }
  return Math.min(index + 1, text.length);
}
