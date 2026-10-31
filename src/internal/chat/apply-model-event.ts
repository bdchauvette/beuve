import type { ChatPart } from './chat-message.ts';
import type { ChatDelta, ChatModelProgress } from './chat-model.ts';
import type { ChatPartEvent } from './chat-part-event.ts';

/** The parts after an event, and the part events it caused. */
export interface AppliedEvent {
  readonly state: StreamedParts;
  readonly events: readonly ChatPartEvent[];
}

/**
 * An answer's parts while its request runs (ADR 0072). Plain data; a run starts from
 * `{ parts: [], nextId: 1, tools: {} }`.
 */
export interface StreamedParts {
  readonly parts: readonly ChatPart[];
  /** The number the next part's id takes; ids are never reused. */
  readonly nextId: number;
  /** The text part appends go to, until `text-end`, a reset or the end of the run. */
  readonly openText?: string;
  /** Running tool calls: the port's tool id to the part's id. */
  readonly tools: Readonly<Record<string, string>>;
}

/** What the model port reports while it runs, and `stop` when the run is over. */
export type ModelStreamEvent =
  | { readonly kind: 'progress'; readonly progress: ChatModelProgress }
  | { readonly kind: 'text'; readonly delta: ChatDelta }
  | { readonly kind: 'stop' };

/**
 * Folds one event of the model port into an answer's parts and says what changed, as part
 * events to push to the renderer (ADR 0072). Thinking opens a reasoning part (a new summary ends
 * it and opens another); a tool start opens a tool call that its end closes as `done` or
 * `failed`; text opens a text part on its first append, which `text-end` closes; a `reset`
 * discards the text written so far (the port's final answer is the last turn's); `stop` ends
 * whatever is open, a running tool as `stopped`. `started` changes no part. Pure.
 */
export function applyModelEvent(state: StreamedParts, event: ModelStreamEvent): AppliedEvent {
  let { parts, nextId, openText, tools } = state;
  const events: ChatPartEvent[] = [];

  const start = (part: ChatPart): void => {
    parts = [...parts, part];
    nextId += 1;
    events.push({ type: 'part-start', part });
  };
  const newId = (): string => `p${String(nextId)}`;
  const end = (id: string, change: (part: ChatPart) => ChatPart): void => {
    parts = parts.map((part) => {
      if (part.id !== id) {
        return part;
      }
      const ended = change(part);
      events.push({ type: 'part-end', part: ended });
      return ended;
    });
  };
  const endReasoning = (): void => {
    const open = openReasoning(parts);
    if (open !== undefined) {
      end(open.id, () => {
        return { ...open, state: 'done' };
      });
    }
  };
  const endText = (): void => {
    if (openText === undefined) {
      return;
    }

    end(openText, (part) => part);
    openText = undefined;
  };

  switch (event.kind) {
    case 'progress': {
      const { progress } = event;
      switch (progress.kind) {
        case 'started': {
          break;
        }
        case 'thinking': {
          const open = openReasoning(parts);
          if (open !== undefined && (progress.summary ?? open.summary) === open.summary) {
            break;
          }
          endReasoning();
          start({
            kind: 'reasoning',
            id: newId(),
            state: 'running',
            ...(progress.summary !== undefined && { summary: progress.summary }),
          });
          break;
        }
        case 'tool-start': {
          endReasoning();
          const id = newId();
          start({
            kind: 'tool-call',
            id,
            tool: progress.tool,
            description: progress.description,
            state: 'running',
          });
          tools = { ...tools, [progress.id]: id };
          break;
        }
        case 'tool-end': {
          const id = tools[progress.id];
          if (id === undefined) {
            break;
          }
          tools = Object.fromEntries(
            Object.entries(tools).filter(([toolId]) => toolId !== progress.id),
          );
          end(id, (part) => {
            if (part.kind !== 'tool-call') {
              return part;
            }
            if (progress.ok) {
              return { ...part, state: 'done' };
            }
            return { ...part, state: 'failed' };
          });
          break;
        }
        case 'text-start': {
          endReasoning();
          break;
        }
        case 'text-end': {
          endText();
          break;
        }
      }
      break;
    }
    case 'text': {
      const { delta } = event;
      if (delta.kind === 'reset') {
        for (const part of parts) {
          if (part.kind === 'text') {
            events.push({ type: 'part-discard', partId: part.id });
          }
        }
        parts = parts.filter((part) => part.kind !== 'text');
        openText = undefined;
        break;
      }
      if (delta.text === '') {
        break;
      }
      endReasoning();
      if (openText === undefined) {
        openText = newId();
        start({ kind: 'text', id: openText, text: '' });
      }
      const id = openText;
      parts = parts.map((part) => {
        if (part.id === id && part.kind === 'text') {
          return { ...part, text: part.text + delta.text };
        }
        return part;
      });
      events.push({ type: 'text-delta', partId: id, text: delta.text });
      break;
    }
    case 'stop': {
      endReasoning();
      endText();
      for (const id of Object.values(tools)) {
        end(id, (part) => {
          if (part.kind === 'tool-call') {
            return { ...part, state: 'stopped' };
          }
          return part;
        });
      }
      tools = {};
      break;
    }
  }

  return {
    state: { parts, nextId, tools, ...(openText !== undefined && { openText }) },
    events,
  };
}

function openReasoning(
  parts: readonly ChatPart[],
): Extract<ChatPart, { kind: 'reasoning' }> | undefined {
  return parts.findLast((part): part is Extract<ChatPart, { kind: 'reasoning' }> => {
    return part.kind === 'reasoning' && part.state === 'running';
  });
}
