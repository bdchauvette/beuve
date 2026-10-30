import type { ChatStreamEvent } from '#contract/ipc-contract.ts';

/** Subscribes a listener to `chat:stream` events and returns the unsubscribe function. */
export type ChatStreamSubscribe = (listener: (event: ChatStreamEvent) => void) => () => void;

export interface TextPartStreamOptions {
  readonly messageId: string;
  readonly partId: string;
  /** Text the part already has (a renderer that starts mid-stream); enqueued first. */
  readonly initialText?: string;
  /** Aborting errors the stream with the signal's reason and unsubscribes. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * One text part's deltas as a WHATWG `ReadableStream<string>` (ADR 0072), for a renderer that
 * consumes text as it is written (a streaming Markdown renderer can `pipeThrough` it). Each
 * `text-delta` of the part is one chunk, in order, so the chunks concatenate to the part's text.
 * The stream closes when the part ends or its message does (`part-end`, `message`), and errors
 * when the model discards the part (it wrote it before a tool call): drop what was rendered.
 * Cancelling it, or the signal, unsubscribes.
 */
export function textPartStream(
  subscribe: ChatStreamSubscribe,
  options: TextPartStreamOptions,
): ReadableStream<string> {
  const { messageId, partId, signal } = options;
  let unsubscribe: (() => void) | undefined;
  const stop = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
  return new ReadableStream<string>({
    start: (controller): void => {
      if (options.initialText !== undefined && options.initialText !== '') {
        controller.enqueue(options.initialText);
      }
      const onAbort = (): void => {
        stop();
        controller.error(signal?.reason);
      };
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      unsubscribe = subscribe((event) => {
        if (event.messageId !== messageId) {
          return;
        }
        if (event.type === 'text-delta' && event.partId === partId) {
          controller.enqueue(event.text);
        } else if (
          event.type === 'message' ||
          (event.type === 'part-end' && event.part.id === partId)
        ) {
          stop();
          signal?.removeEventListener('abort', onAbort);
          controller.close();
        } else if (event.type === 'part-discard' && event.partId === partId) {
          stop();
          signal?.removeEventListener('abort', onAbort);
          controller.error(new Error('The model discarded this text.'));
        }
      });
    },
    cancel: (): void => {
      stop();
    },
  });
}
