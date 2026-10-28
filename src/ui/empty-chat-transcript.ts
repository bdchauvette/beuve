import type { ChatTranscript } from './chat-entry.ts';

/** A transcript with nothing in it, the state before a session's chat is loaded. */
export const emptyChatTranscript: ChatTranscript = { entries: [], pending: {} };
