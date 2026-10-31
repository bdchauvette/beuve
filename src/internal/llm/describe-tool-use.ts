import path from 'node:path';

const maxChars = 80;

/**
 * A short, content-free name for one read-only tool call (ADR 0070), for a status line:
 * `read src/auth.ts:1-40`, `grep validate(`, `glob **\/*.test.ts`. Understands Claude Code's
 * `Read`/`Grep`/`Glob` inputs and the OpenAI-compatible sandbox's `read_file`/`grep`/`glob`;
 * paths inside `cwd` are shown relative to it. The input is the model's and untrusted, so every
 * field is checked and the result is cut to 80 characters on one line.
 */
export function describeToolUse(tool: string, input: unknown, cwd?: string): string {
  const fields = fieldsOf(input);
  const text = (key: string): string | undefined => {
    if (typeof fields[key] === 'string') {
      return fields[key];
    }
    return undefined;
  };
  const count = (key: string): number | undefined => {
    if (typeof fields[key] === 'number' && Number.isSafeInteger(fields[key])) {
      return fields[key];
    }
    return undefined;
  };
  const shown = (file: string | undefined): string => {
    if (file === undefined) {
      return '';
    }
    if (cwd === undefined || !path.isAbsolute(file)) {
      return file;
    }
    const relative = path.relative(cwd, file);
    if (relative === '') {
      return '.';
    }
    if (relative.startsWith('..')) {
      return file;
    }
    return relative;
  };
  let description: string;
  switch (tool.toLowerCase()) {
    case 'read':
    case 'read_file': {
      const file = shown(text('file_path') ?? text('path'));
      const start = count('offset') ?? count('start_line');
      const limit = count('limit');
      let end = count('end_line');
      if (end === undefined && start !== undefined && limit !== undefined) {
        end = start + limit - 1;
      }
      description = `read ${file}${rangeText(start, end)}`;
      break;
    }
    case 'grep': {
      const where = shown(text('path'));
      description = `grep ${text('pattern') ?? ''}`;
      if (where !== '') {
        description += ` in ${where}`;
      }
      break;
    }
    case 'glob': {
      description = `glob ${text('pattern') ?? ''}`;
      break;
    }
    default: {
      description = tool;
    }
  }
  const line = description.replaceAll(/\s+/gu, ' ').trim();
  if (line.length > maxChars) {
    return `${line.slice(0, maxChars - 1)}…`;
  }
  return line;
}

function fieldsOf(input: unknown): Record<string, unknown> {
  if (typeof input === 'object' && input !== null) {
    return input as Record<string, unknown>;
  }
  return {};
}

/** `:12-40`, `:12`, or nothing without a start. */
function rangeText(start: number | undefined, end: number | undefined): string {
  if (start === undefined) {
    return '';
  }
  if (end === undefined) {
    return `:${String(start)}`;
  }
  return `:${String(start)}-${String(end)}`;
}
