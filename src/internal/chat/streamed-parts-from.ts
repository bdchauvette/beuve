import type { StreamedParts } from './apply-model-event.ts';
import type { ChatPart } from './chat-message.ts';

/**
 * Stored parts as a run's state again (ADR 0072), so an answer no run is writing any more (the
 * app quit while it streamed) can be ended like one: ids go on after the highest, and running
 * tool calls are open. Pure.
 */
export function streamedPartsFrom(parts: readonly ChatPart[]): StreamedParts {
  const highest = Math.max(0, ...parts.map((part) => Number(part.id.slice(1)) || 0));
  const tools = Object.fromEntries(
    parts.flatMap((part) =>
      part.kind === 'tool-call' && part.state === 'running' ? [[part.id, part.id]] : [],
    ),
  );
  return { parts, nextId: highest + 1, tools };
}
