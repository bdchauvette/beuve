import { constants } from 'node:fs';
import type { Dirent } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

/** Caps on what one tool call may read or return. Every field has a default. */
export interface SandboxLimits {
  /** Bytes read from one file. Defaults to 256 KiB; a longer file is cut and says so. */
  readonly maxFileBytes?: number;
  /** Lines `read_file` returns at most. Defaults to 2000. */
  readonly maxLines?: number;
  /** Matches `grep` returns at most. Defaults to 100. */
  readonly maxMatches?: number;
  /** Paths `glob` returns at most. Defaults to 500. */
  readonly maxPaths?: number;
  /** Directory entries one search visits at most. Defaults to 20,000. */
  readonly maxEntries?: number;
}

/** A tool definition in the OpenAI chat completions `tools` shape. */
export interface SandboxToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

/** What a tool call answers: text for the model, and whether the call was refused. */
export interface SandboxResult {
  readonly output: string;
  readonly denied: boolean;
}

/** Read-only file tools confined to one directory, for a model without its own harness. */
export interface ReadOnlySandbox {
  readonly definitions: readonly SandboxToolDefinition[];
  /** Runs one call with the model's raw JSON arguments. Never rejects. */
  readonly run: (name: string, rawArguments: string) => Promise<SandboxResult>;
}

const maxLineChars = 300;

const readFileArguments = z.strictObject({
  path: z.string().min(1).max(4096),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
});
const grepArguments = z.strictObject({
  pattern: z.string().min(1).max(1000),
  path: z.string().min(1).max(4096).optional(),
  glob: z.string().min(1).max(1000).optional(),
  ignore_case: z.boolean().optional(),
});
const globArguments = z.strictObject({ pattern: z.string().min(1).max(1000) });

/** More wildcards than this could make matching one path slow, so such a glob is refused. */
const maxWildcards = 12;
const wildcards = /[*?]/gu;
const negation = /^!/u;
const matchesNothing = /(?!)/u;
/** A glob's special tokens and the characters a regular expression would read as syntax. */
const globToken = /\*\*\/|\*\*|\*|\?|\{|\}|,|\[[^\]]+\]|[.+^$()|\\[\]/]/gu;

/**
 * `read_file`, `grep` and `glob` over `root` (the session worktree) for the OpenAI-compatible
 * adapter (ADR 0071). Nothing writes, runs or fetches. Every path is resolved against `root`'s
 * real path and refused when it leaves it, lexically (`..`, an absolute path elsewhere) or through
 * a symbolic link (the target's real path must be inside too); searches never follow links and
 * skip `.git`. `grep` matches a fixed string, never a regular expression, so a model-written
 * pattern can't hang main's event loop. Sizes, lines, matches, paths and visited entries are
 * capped, and a capped answer says so.
 */
export function createReadOnlySandbox(root: string, limits: SandboxLimits = {}): ReadOnlySandbox {
  const caps = {
    maxFileBytes: limits.maxFileBytes ?? 256 * 1024,
    maxLines: limits.maxLines ?? 2000,
    maxMatches: limits.maxMatches ?? 100,
    maxPaths: limits.maxPaths ?? 500,
    maxEntries: limits.maxEntries ?? 20_000,
  };
  let realRoot: Promise<string> | undefined;
  const rootPath = async (): Promise<string> => {
    realRoot ??= realpath(root);
    return realRoot;
  };

  /** The real path of `requested` inside the root, or why it is refused. */
  const resolve = async (
    requested: string,
  ): Promise<{ readonly path: string } | { readonly refused: string }> => {
    const base = await rootPath();
    const lexical = path.resolve(base, requested);
    if (!isInside(base, lexical)) {
      return { refused: `refused: ${requested} is outside the working directory` };
    }
    let real: string;
    try {
      real = await realpath(lexical);
    } catch {
      return { refused: `not found: ${requested}` };
    }
    return isInside(base, real)
      ? { path: real }
      : { refused: `refused: ${requested} links outside the working directory` };
  };

  const readFileTool = async (input: z.infer<typeof readFileArguments>): Promise<SandboxResult> => {
    const resolved = await resolve(input.path);
    if ('refused' in resolved) {
      return { output: resolved.refused, denied: resolved.refused.startsWith('refused') };
    }
    const text = await readCapped(resolved.path, caps.maxFileBytes);
    if (text === undefined) {
      return { output: `not a readable text file: ${input.path}`, denied: false };
    }
    const lines = text.content.split('\n');
    const start = input.start_line ?? 1;
    const end = Math.min(input.end_line ?? lines.length, lines.length, start + caps.maxLines - 1);
    const width = String(end).length;
    const numbered = lines
      .slice(start - 1, end)
      .map((line, offset) => `${String(start + offset).padStart(width)}\t${line}`);
    const notes = [
      ...(text.isCut ? [`[cut at ${String(caps.maxFileBytes)} bytes]`] : []),
      ...(end < (input.end_line ?? lines.length) && !text.isCut
        ? [`[lines ${String(end + 1)}-${String(input.end_line ?? lines.length)} not shown]`]
        : []),
    ];
    return { output: [...numbered, ...notes].join('\n'), denied: false };
  };

  const grepTool = async (input: z.infer<typeof grepArguments>): Promise<SandboxResult> => {
    const base = await rootPath();
    const scope = await resolve(input.path ?? '.');
    if ('refused' in scope) {
      return { output: scope.refused, denied: scope.refused.startsWith('refused') };
    }
    const needle = input.ignore_case === true ? input.pattern.toLowerCase() : input.pattern;
    const matcher = input.glob === undefined ? undefined : globMatcher(input.glob);
    if (matcher === null) {
      return tooManyWildcards();
    }
    const matches: string[] = [];
    let isCapped = false;
    for await (const file of walk(scope.path, caps.maxEntries)) {
      const relative = path.relative(base, file);
      if (matcher !== undefined && !matcher.test(relative) && !matcher.test(path.basename(file))) {
        continue;
      }
      const text = await readCapped(file, caps.maxFileBytes);
      const found =
        text === undefined
          ? []
          : matchingLines(text.content, needle, input.ignore_case === true).map(
              ({ number, line }) => `${relative}:${String(number)}: ${line.slice(0, maxLineChars)}`,
            );
      const room = caps.maxMatches - matches.length;
      matches.push(...found.slice(0, room));
      if (found.length > room) {
        isCapped = true;
        break;
      }
    }
    return {
      output:
        matches.length === 0
          ? 'no matches'
          : [
              ...matches,
              ...(isCapped ? [`[stopped at ${String(caps.maxMatches)} matches]`] : []),
            ].join('\n'),
      denied: false,
    };
  };

  const globTool = async (input: z.infer<typeof globArguments>): Promise<SandboxResult> => {
    const base = await rootPath();
    const matcher = globMatcher(input.pattern);
    if (matcher === null) {
      return tooManyWildcards();
    }
    const found: string[] = [];
    let isCapped = false;
    for await (const file of walk(base, caps.maxEntries)) {
      const relative = path.relative(base, file).split(path.sep).join('/');
      if (!matcher.test(relative)) {
        continue;
      }
      if (found.length === caps.maxPaths) {
        isCapped = true;
        break;
      }
      found.push(relative);
    }
    return {
      output:
        found.length === 0
          ? 'no files'
          : [...found, ...(isCapped ? [`[stopped at ${String(caps.maxPaths)} paths]`] : [])].join(
              '\n',
            ),
      denied: false,
    };
  };

  return {
    definitions,
    run: async (name, rawArguments): Promise<SandboxResult> => {
      let json: unknown;
      try {
        json = JSON.parse(rawArguments === '' ? '{}' : rawArguments);
      } catch {
        return { output: 'invalid arguments: not JSON', denied: false };
      }
      try {
        switch (name) {
          case 'read_file': {
            const parsed = readFileArguments.safeParse(json);
            return parsed.success
              ? await readFileTool(parsed.data)
              : invalidArguments(parsed.error);
          }
          case 'grep': {
            const parsed = grepArguments.safeParse(json);
            return parsed.success ? await grepTool(parsed.data) : invalidArguments(parsed.error);
          }
          case 'glob': {
            const parsed = globArguments.safeParse(json);
            return parsed.success ? await globTool(parsed.data) : invalidArguments(parsed.error);
          }
          default: {
            return { output: `refused: there is no tool named ${name}`, denied: true };
          }
        }
      } catch {
        return { output: `the ${name} call failed`, denied: false };
      }
    },
  };
}

const definitions: readonly SandboxToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a text file of the repository (the working directory), with line numbers. Paths are relative to the repository root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative path.' },
          start_line: { type: 'integer', minimum: 1, description: 'First line, 1-based.' },
          end_line: { type: 'integer', minimum: 1, description: 'Last line, inclusive.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description:
        'Find lines containing a fixed string (not a regular expression) in the repository. Answers path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'The exact text to find.' },
          path: {
            type: 'string',
            description: 'A file or directory to search; the root if omitted.',
          },
          glob: { type: 'string', description: 'Only files matching this glob, e.g. **/*.ts.' },
          ignore_case: { type: 'boolean' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'List repository files whose relative path matches a glob such as src/**/*.ts.',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
];

function isInside(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** The 1-based numbers and text of the lines that contain `needle`, a fixed string. */
function matchingLines(
  content: string,
  needle: string,
  isCaseInsensitive: boolean,
): { readonly number: number; readonly line: string }[] {
  return content
    .split('\n')
    .map((line, index) => ({ number: index + 1, line }))
    .filter(({ line }) => (isCaseInsensitive ? line.toLowerCase() : line).includes(needle));
}

function tooManyWildcards(): SandboxResult {
  return { output: `invalid arguments: at most ${String(maxWildcards)} wildcards`, denied: false };
}

function invalidArguments(error: z.ZodError): SandboxResult {
  return { output: `invalid arguments: ${z.prettifyError(error)}`, denied: false };
}

/**
 * At most `maxBytes` of a regular file as UTF-8 text, or `undefined` if it is not one. The file is
 * opened once and the handle is asked what it is (ADR 0082), so a swap between a check and the
 * read can't make it read something else; `O_NONBLOCK` keeps a FIFO from blocking the open.
 */
async function readCapped(
  file: string,
  maxBytes: number,
): Promise<{ readonly content: string; readonly isCut: boolean } | undefined> {
  await using handle = await openToRead(file);
  if (handle === undefined) {
    return undefined;
  }
  const stats = await handle.stat();
  if (!stats.isFile()) {
    return undefined;
  }
  const buffer = Buffer.alloc(Math.min(maxBytes, stats.size));
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  const bytes = buffer.subarray(0, bytesRead);
  return bytes.includes(0)
    ? undefined
    : { content: bytes.toString('utf8'), isCut: stats.size > maxBytes };
}

/** `file` opened for reading, or `undefined` when it can't be. */
async function openToRead(file: string): Promise<FileHandle | undefined> {
  try {
    return await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
}

/**
 * Regular files under `directory` (or `directory` itself when it is one), in a stable order,
 * without following symbolic links and skipping `.git`, visiting at most `maxEntries` entries.
 */
async function* walk(directory: string, maxEntries: number): AsyncGenerator<string> {
  const top = await stat(directory);
  if (top.isFile()) {
    yield directory;
    return;
  }
  const pending = [directory];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      break;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visited += 1;
      if (visited > maxEntries) {
        return;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== '.git') {
        pending.push(full);
      } else if (entry.isFile()) {
        yield full;
      }
    }
  }
}

/**
 * A glob as a regular expression over `/`-separated relative paths: `**` spans directories,
 * `*` and `?` stay within one, `{a,b}` is a choice and `[…]` a class. Everything else is
 * literal. The pattern is the model's: with more than {@link maxWildcards} wildcards it is
 * refused (`null`), which bounds the backtracking of the expression it makes.
 */
function globMatcher(pattern: string): RegExp | null {
  if ((pattern.match(wildcards) ?? []).length > maxWildcards) {
    // eslint-disable-next-line unicorn/no-null -- distinct from "no glob given".
    return null;
  }
  let depth = 0;
  const source = pattern.replaceAll(globToken, (token: string): string => {
    switch (token) {
      case '**/': {
        return '(?:[^/]*/)*';
      }
      case '**': {
        return '.*';
      }
      case '*': {
        return '[^/]*';
      }
      case '?': {
        return '[^/]';
      }
      case '{': {
        depth += 1;
        return '(?:';
      }
      case '}': {
        if (depth === 0) {
          return String.raw`\}`;
        }
        depth -= 1;
        return ')';
      }
      case ',': {
        return depth > 0 ? '|' : ',';
      }
      default: {
        return token.startsWith('[') && token.length > 2
          ? `[${token.slice(1, -1).replaceAll('\\', '\\\\').replace(negation, '^')}]`
          : RegExp.escape(token);
      }
    }
  });
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- built from escaped tokens.
    return new RegExp(`^${source}${')'.repeat(depth)}$`, 'u');
  } catch {
    return matchesNothing;
  }
}
