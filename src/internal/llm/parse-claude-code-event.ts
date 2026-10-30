import { claudeCodeEventFrom } from './claude-code-event-from.ts';
import type { ClaudeCodeEvent } from './claude-code-event-from.ts';

/** Parses one line of Claude Code's stream-json output. Never throws. */
export function parseClaudeCodeEvent(text: string): ClaudeCodeEvent {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'not JSON' };
  }
  return claudeCodeEventFrom(json);
}
