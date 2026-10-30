import type { ChatDeltaView, ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatEntry, ChatTranscript, MessageChatEntry, PendingAnswer } from './chat-entry.ts';
import { emptyChatTranscript } from './empty-chat-transcript.ts';

/** What happens to the stored part of the transcript (ADR 0031). */
export type ChatTranscriptAction =
  /** The session's history, replacing its message entries (an answer streaming here stays). */
  | { readonly kind: 'loaded'; readonly messages: readonly ChatMessageView[] }
  /** `chat:ask` answered: the stored question and the streaming answer. */
  | {
      readonly kind: 'asked';
      readonly question: ChatMessageView;
      readonly answer: ChatMessageView;
    }
  | { readonly kind: 'delta'; readonly delta: ChatDeltaView }
  /** `chat:message-updated`: the answer started (it was queued), completed, failed or stopped. */
  | { readonly kind: 'updated'; readonly message: ChatMessageView }
  /** `/compact` stored its summary: it joins the transcript where the compaction entry was. */
  | { readonly kind: 'compacted'; readonly summary: ChatMessageView }
  /** `/clear`: every entry goes, local ones included. */
  | { readonly kind: 'cleared' };

/**
 * Folds chat events into the transcript. Events can beat the `chat:ask` response (the answer
 * starts before it returns), so those for a message not yet listed wait in `pending` and are
 * replayed when `asked` lands. Pure.
 */
export function reduceChatTranscript(
  state: ChatTranscript,
  action: ChatTranscriptAction,
): ChatTranscript {
  switch (action.kind) {
    case 'loaded': {
      const local = state.entries.filter((entry) => entry.kind !== 'message');
      const live = new Map(
        state.entries.flatMap((entry) =>
          entry.kind === 'message' && entry.message.status === 'streaming'
            ? [[entry.id, entry] as const]
            : [],
        ),
      );
      // A streaming answer here is newer than the stored preview, which lags by up to a second.
      const entries = action.messages.map(
        (message): MessageChatEntry =>
          (message.status === 'streaming' ? live.get(message.id) : undefined) ?? entryFrom(message),
      );
      return { entries: [...entries, ...local], pending: {} };
    }
    case 'asked': {
      if (hasMessage(state.entries, action.answer.id)) {
        return state;
      }
      const { [action.answer.id]: early, ...pending } = state.pending;
      return {
        entries: [
          ...state.entries,
          entryFrom(action.question),
          entryFrom(replay(action.answer, early)),
        ],
        pending,
      };
    }
    case 'delta': {
      return applyDelta(state, action.delta);
    }
    case 'updated': {
      return hasMessage(state.entries, action.message.id)
        ? { ...state, entries: replaceMessage(state.entries, action.message) }
        : {
            ...state,
            pending: {
              ...state.pending,
              [action.message.id]: {
                text: state.pending[action.message.id]?.text ?? '',
                settled: action.message,
              },
            },
          };
    }
    case 'compacted': {
      if (hasMessage(state.entries, action.summary.id)) {
        return state;
      }
      const entry = entryFrom(action.summary);
      const at = state.entries.findIndex((item) => item.kind === 'compaction');
      const entries =
        at === -1
          ? [...state.entries, entry]
          : state.entries.flatMap((item, index) =>
              index === at ? [entry] : item.kind === 'compaction' ? [] : [item],
            );
      return { ...state, entries };
    }
    case 'cleared': {
      return emptyChatTranscript;
    }
  }
}

function applyDelta(state: ChatTranscript, delta: ChatDeltaView): ChatTranscript {
  const grow = (text: string): string => {
    switch (delta.kind) {
      case 'reset': {
        return '';
      }
      case 'append': {
        return text + delta.text;
      }
      case 'progress': {
        return text;
      }
    }
  };
  const listed = state.entries.find(
    (entry): entry is MessageChatEntry =>
      entry.kind === 'message' && entry.message.id === delta.messageId,
  );
  if (listed === undefined) {
    const early = state.pending[delta.messageId];
    const pending = {
      ...state.pending,
      [delta.messageId]: { ...early, text: grow(early?.text ?? '') },
    };
    return { ...state, pending };
  }
  if (listed.message.status !== 'streaming') {
    return state;
  }
  if (delta.kind === 'progress') {
    return {
      ...state,
      entries: state.entries.map((entry) =>
        entry === listed ? { ...listed, progress: delta.text } : entry,
      ),
    };
  }
  return {
    ...state,
    entries: replaceMessage(state.entries, {
      ...listed.message,
      content: grow(listed.message.content),
    }),
  };
}

function replay(answer: ChatMessageView, early: PendingAnswer | undefined): ChatMessageView {
  if (early === undefined) {
    return answer;
  }
  const { settled } = early;
  return settled === undefined || settled.status === 'streaming'
    ? { ...(settled ?? answer), content: early.text }
    : settled;
}

function entryFrom(message: ChatMessageView): MessageChatEntry {
  return { id: message.id, kind: 'message', message };
}

function hasMessage(entries: readonly ChatEntry[], id: string): boolean {
  return entries.some((entry) => entry.kind === 'message' && entry.message.id === id);
}

/** Replaces a message; a streaming answer keeps its status line until it settles. */
function replaceMessage(entries: readonly ChatEntry[], message: ChatMessageView): ChatEntry[] {
  return entries.map((entry) => {
    if (entry.kind !== 'message' || entry.message.id !== message.id) {
      return entry;
    }
    return message.status === 'streaming' && entry.progress !== undefined
      ? { ...entryFrom(message), progress: entry.progress }
      : entryFrom(message);
  });
}
