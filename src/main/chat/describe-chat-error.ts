import type { ChatErrorCode } from '#contract/ipc-contract.ts';

const messages: Readonly<Record<ChatErrorCode, string>> = {
  'not-installed':
    'The model could not be started. Install Claude Code (or set BEUVE_CLAUDE_PATH to it), or pick another model in Settings ▸ Models.',
  'not-authenticated':
    'The model was not signed in. Run `claude` in a terminal and log in, or check the API key in Settings ▸ Models, then ask again.',
  'rate-limited': 'The model is rate-limited. Wait a while, then ask again.',
  timeout: 'The model did not answer in time. Ask something narrower, or retry.',
  'model-failed':
    'The model gave no usable answer. Ask again, or use Test in Settings ▸ Models to see why.',
  'chat-unavailable': 'The change could not be read, so there is nothing to ask about. Try again.',
  'nothing-to-review':
    'Nothing to review: no changed text file is in scope, or everything up to the head is marked reviewed.',
  internal: 'Something went wrong inside beuve. The question was not answered.',
};

/** What the transcript says about a failed answer: the cause and what to do (ADR 0031). */
export function describeChatError(code: ChatErrorCode): string {
  return messages[code];
}
