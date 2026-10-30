import type { ChatErrorCode } from '#contract/ipc-contract.ts';

const messages: Readonly<Record<ChatErrorCode, string>> = {
  'not-installed':
    'Claude Code could not be started. Install it, or set BEUVE_CLAUDE_PATH to its executable.',
  'not-authenticated':
    'Claude Code is not logged in. Run `claude` in a terminal and log in, then ask again.',
  'rate-limited': 'Claude Code is rate-limited. Wait a while, then ask again.',
  timeout: 'Claude Code did not answer in time. Ask something narrower, or retry.',
  'model-failed': 'Claude Code gave no usable answer. Ask again.',
  'chat-unavailable': 'The change could not be read, so there is nothing to ask about. Try again.',
  'nothing-to-review':
    'Nothing to review: no changed text file is in scope, or everything up to the head is marked reviewed.',
  internal: 'Something went wrong inside beuve. The question was not answered.',
};

/** What the transcript says about a failed answer: the cause and what to do (ADR 0031). */
export function describeChatError(code: ChatErrorCode): string {
  return messages[code];
}
