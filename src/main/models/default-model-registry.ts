import type { ModelRegistry } from './model-registry.ts';

/**
 * The registry before the user configures anything (ADR 0070): one entry that runs the user's
 * installed Claude Code with their own login (ADR 0019), used for every role.
 */
export const defaultModelRegistry: ModelRegistry = {
  entries: [{ id: 'claude-code', label: 'Claude Code (your login)', kind: 'claude-code-cli' }],
  roles: {
    chat: 'claude-code',
    review: 'claude-code',
    verify: 'claude-code',
    summarize: 'claude-code',
    compact: 'claude-code',
  },
};
