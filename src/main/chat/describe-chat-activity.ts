import type { ModelStreamEvent } from '#internal/chat/apply-model-event.ts';
import type { ChatModelProgress } from '#internal/chat/chat-model.ts';

/**
 * The status line of a running question or `/summarize` (ADR 0072, 0073): what the configured
 * model (`name`) does now, from the port's coarse progress. A tool call names what it looks at
 * (`read src/auth.ts:1-40`), never what it found; `undefined` keeps the line as it is.
 */
export function describeChatActivity(name: string, event: ModelStreamEvent): string | undefined {
  switch (event.kind) {
    case 'progress': {
      return progressActivity(name, event.progress);
    }
    case 'text': {
      if (event.delta.kind === 'append' && event.delta.text !== '') {
        return `${name} is writing`;
      }
      return undefined;
    }
    case 'stop': {
      return undefined;
    }
  }
}

function progressActivity(name: string, progress: ChatModelProgress): string | undefined {
  switch (progress.kind) {
    case 'thinking':
    case 'tool-end': {
      return `${name} is thinking`;
    }
    case 'tool-start': {
      return `${name}: ${progress.description}`;
    }
    case 'text-start': {
      return `${name} is writing`;
    }
    case 'started':
    case 'text-end': {
      return undefined;
    }
  }
}
