import type { ModelError } from '#internal/llm/language-model.ts';
import { formatDuration } from '#x/time/format-duration.ts';

/**
 * A sentence for a model failure in the Settings window (ADR 0070): what went wrong and what to
 * do. It never contains a prompt or a key; server messages are quoted as they came, cut short.
 */
export function describeModelError(error: ModelError, locale?: Intl.LocalesArgument): string {
  switch (error.kind) {
    case 'invalid-request': {
      return `The request was refused before it was sent: ${error.reason}.`;
    }
    case 'not-installed': {
      return `${error.command} could not be started. Install Claude Code, or check the path.`;
    }
    case 'unsupported-version': {
      return (
        `${error.command} is Claude Code ${error.version}, older than ${error.required}, the version ` +
        'the Agent SDK speaks. Update it, or switch the executable to Bundled.'
      );
    }
    case 'not-authenticated': {
      return `Not signed in: ${short(error.message)}`;
    }
    case 'rate-limited': {
      return `Rate-limited${error.resetsAt === undefined ? '' : ` until ${error.resetsAt}`}: ${short(error.message)}`;
    }
    case 'timeout': {
      return `No answer within ${formatDuration(error.timeout, locale)}.`;
    }
    case 'cancelled': {
      return 'Cancelled.';
    }
    case 'output-too-large': {
      return 'The answer was too large.';
    }
    case 'invalid-output': {
      return `The answer was not usable: ${short(error.reason)}`;
    }
    case 'model-failed': {
      return `${error.status === undefined ? 'The model failed' : `HTTP ${String(error.status)}`}: ${short(error.message)}`;
    }
    case 'process-failed': {
      return `Claude Code stopped${error.exitCode === undefined ? '' : ` with exit code ${String(error.exitCode)}`}: ${short(error.stderr)}`;
    }
  }
}

function short(text: string): string {
  const line = text.replaceAll(/\s+/gu, ' ').trim();
  if (line.length > 300) {
    return `${line.slice(0, 299)}…`;
  }
  return line;
}
