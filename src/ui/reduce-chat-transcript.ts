import type { ChatMessageView, ChatPartView, ChatStreamEvent } from '#contract/ipc-contract.ts';

import type { ChatEntry, ChatTranscript, MessageChatEntry } from './chat-entry.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';

/** What happens to the stored part of the transcript (ADR 0031, 0072). */
export type ChatTranscriptAction =
  /** The session's history, replacing its message entries (a request running here stays). */
  | { readonly kind: 'loaded'; readonly messages: readonly ChatMessageView[] }
  /** `chat:ask` answered: the stored question and its answer, `queued` or `submitted`. */
  | {
      readonly kind: 'asked';
      readonly question: ChatMessageView;
      readonly answer: ChatMessageView;
    }
  /** One `chat:stream` event of this session. */
  | { readonly kind: 'stream'; readonly event: ChatStreamEvent }
  /** `/compact` stored its summary: it joins the transcript where the compaction entry was. */
  | { readonly kind: 'compacted'; readonly summary: ChatMessageView }
  /** `/clear`: every entry goes, local ones included. */
  | { readonly kind: 'cleared' };

/**
 * The chat's state machine (ADR 0072): folds `chat:list`, `chat:ask` and `chat:stream` into the
 * transcript, so the drawer renders from data alone. A request's status moves through `queued`,
 * `submitted` and `streaming`; parts start, grow by text deltas, end or are discarded; a
 * `message` event replaces the message with the stored one and is the only way a request ends.
 * Events for an ended message are stale and ignored. Events can beat the `chat:ask` response
 * (the answer starts before it returns), so those for a message not yet listed wait in `pending`
 * and are replayed in order when it lands. Pure.
 */
export function reduceChatTranscript(
  state: ChatTranscript,
  action: ChatTranscriptAction,
): ChatTranscript {
  switch (action.kind) {
    case 'loaded': {
      const local = state.entries.filter((entry) => entry.kind !== 'message');
      const live = new Map(
        state.entries.flatMap((entry) => {
          if (entry.kind === 'message' && isUnfinished(entry.message)) {
            return [[entry.id, entry] as const];
          }
          return [];
        }),
      );
      // A running request here is newer than the stored preview, which lags by up to a second.
      const entries = action.messages.map((message): MessageChatEntry => {
        if (isUnfinished(message)) {
          return live.get(message.id) ?? entryFrom(message);
        }
        return entryFrom(message);
      });
      return replayPending({ entries: [...entries, ...local], pending: state.pending });
    }
    case 'asked': {
      if (hasMessage(state.entries, action.answer.id)) {
        return state;
      }
      return replayPending({
        entries: [...state.entries, entryFrom(action.question), entryFrom(action.answer)],
        pending: state.pending,
      });
    }
    case 'stream': {
      const { event } = action;
      if (!hasMessage(state.entries, event.messageId)) {
        const early = state.pending[event.messageId] ?? [];
        return { ...state, pending: { ...state.pending, [event.messageId]: [...early, event] } };
      }
      return {
        ...state,
        entries: state.entries.map((entry) => {
          if (entry.kind === 'message' && entry.id === event.messageId) {
            return applyStreamEvent(entry, event);
          }
          return entry;
        }),
      };
    }
    case 'compacted': {
      if (hasMessage(state.entries, action.summary.id)) {
        return state;
      }
      const entry = entryFrom(action.summary);
      const at = state.entries.findIndex((item) => item.kind === 'compaction');
      if (at === -1) {
        return { ...state, entries: [...state.entries, entry] };
      }
      const entries = state.entries.flatMap((item, index) => {
        if (index === at) {
          return [entry];
        }
        if (item.kind === 'compaction') {
          return [];
        }
        return [item];
      });
      return { ...state, entries };
    }
    case 'cleared': {
      return emptyChatTranscript;
    }
  }
}

/** One event applied to its message's entry. */
function applyStreamEvent(entry: MessageChatEntry, event: ChatStreamEvent): MessageChatEntry {
  const { message } = entry;
  if (event.type === 'message') {
    const { activity, ...rest } = entry;
    const replaced = { ...rest, message: event.message };
    if (activity !== undefined && isUnfinished(event.message)) {
      return { ...replaced, activity };
    }
    return replaced;
  }
  if (!isUnfinished(message)) {
    return entry;
  }
  const withParts = (parts: readonly ChatPartView[]): MessageChatEntry => {
    return {
      ...entry,
      message: { ...message, parts },
    };
  };
  switch (event.type) {
    case 'status': {
      const activity = event.activity ?? entry.activity;
      return {
        ...entry,
        message: { ...message, status: event.status },
        ...(activity !== undefined && { activity }),
      };
    }
    case 'part-start': {
      if (message.parts.some((part) => part.id === event.part.id)) {
        return entry;
      }
      return withParts([...message.parts, event.part]);
    }
    case 'text-delta': {
      return withParts(
        message.parts.map((part) => {
          if (part.id === event.partId && part.kind === 'text') {
            return { ...part, text: part.text + event.text };
          }
          return part;
        }),
      );
    }
    case 'part-end': {
      if (message.parts.every((part) => part.id !== event.part.id)) {
        return withParts([...message.parts, event.part]);
      }
      return withParts(
        message.parts.map((part) => {
          if (part.id === event.part.id) {
            return event.part;
          }
          return part;
        }),
      );
    }
    case 'part-discard': {
      return withParts(message.parts.filter((part) => part.id !== event.partId));
    }
  }
}

/** Replays the waiting events of every message the transcript now lists. */
function replayPending(state: ChatTranscript): ChatTranscript {
  let replayed: ChatTranscript = { entries: state.entries, pending: {} };
  const waiting: Record<string, readonly ChatStreamEvent[]> = {};
  for (const [id, events] of Object.entries(state.pending)) {
    if (!hasMessage(state.entries, id)) {
      waiting[id] = events;
      continue;
    }

    for (const event of events) {
      replayed = reduceChatTranscript(replayed, { kind: 'stream', event });
    }
  }
  return { ...replayed, pending: waiting };
}

/** Whether the message's request has not ended: queued, submitted or streaming. */
function isUnfinished(message: ChatMessageView): boolean {
  return (
    message.status === 'queued' || message.status === 'submitted' || message.status === 'streaming'
  );
}

function entryFrom(message: ChatMessageView): MessageChatEntry {
  return { id: message.id, kind: 'message', message };
}

function hasMessage(entries: readonly ChatEntry[], id: string): boolean {
  return entries.some((entry) => entry.kind === 'message' && entry.message.id === id);
}
