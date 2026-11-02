import { commandRegistry } from './command-registry.ts';

/** What `/help` prints in the chat drawer (ADR 0022, 0031, 0057), read from the command registry. */
export const chatHelp: readonly string[] = Object.freeze([
  'Type a question to ask Claude Code about the open change, e.g. “why does parse trim the first part?”. It reads the diff and the checked-out head, answers with links into the code, and never edits anything. What you send while an answer runs waits its turn; Cancel stops only that answer. Each question sends the question, the diff, earlier turns and any worktree files Claude reads to Anthropic under your Claude Code account’s terms.',
  ...commandRegistry
    .filter((command) => command.slash !== undefined)
    .map(({ slash = '', help, title }) => `${slash} — ${help ?? title}`),
]);
