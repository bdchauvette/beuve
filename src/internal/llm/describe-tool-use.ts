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
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const text = (key: string): string | undefined => {
    return typeof fields[key] === 'string' ? fields[key] : undefined;
  };
  const count = (key: string): number | undefined => {
    return typeof fields[key] === 'number' && Number.isSafeInteger(fields[key])
      ? fields[key]
      : undefined;
  };
  const shown = (file: string | undefined): string => {
    return file === undefined ? '' : cwd === undefined ? file : relativeTo(cwd, file);
  };
  let description: string;
  switch (tool.toLowerCase()) {
    case 'read':
    case 'read_file': {
      const file = shown(text('file_path') ?? text('path'));
      const start = count('offset') ?? count('start_line');
      const limit = count('limit');
      const end =
        count('end_line') ??
        (start === undefined || limit === undefined ? undefined : start + limit - 1);
      const range =
        start === undefined ? '' : `:${String(start)}${end === undefined ? '' : `-${String(end)}`}`;
      description = `read ${file}${range}`;
      break;
    }
    case 'grep': {
      const where = shown(text('path'));
      description = `grep ${text('pattern') ?? ''}${where === '' ? '' : ` in ${where}`}`;
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
  return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}

function relativeTo(cwd: string, file: string): string {
  if (!path.isAbsolute(file)) {
    return file;
  }
  const relative = path.relative(cwd, file);
  return relative === '' ? '.' : relative.startsWith('..') ? file : relative;
}
