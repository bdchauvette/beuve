import type { ModelEntryView } from '#contract/ipc-contract.ts';

/** One registry entry as the Settings list shows it. */
export interface ModelEntryLine {
  readonly title: string;
  /** What it runs and where, e.g. `qwen3:8b at http://localhost:11434/v1 · no tools`. */
  readonly detail: string;
  /** Set when the entry sends the change off this machine to a server the user named. */
  readonly warning?: string;
}

/**
 * The label and a one-line detail of a model entry (ADR 0070). The copy says what runs ("runs
 * Claude Code", "via Claude Code"); it never suggests who made beuve. Pure.
 */
export function describeModelEntry(entry: ModelEntryView): ModelEntryLine {
  const effort = entry.effort === undefined ? '' : ` · effort ${entry.effort}`;
  switch (entry.kind) {
    case 'claude-code-cli': {
      return {
        title: entry.label,
        detail: `Runs Claude Code with your login · ${entry.model ?? 'its default model'}${effort}`,
      };
    }
    case 'claude-agent-sdk': {
      const executable =
        entry.executable.source === 'bundled'
          ? 'bundled Claude Code'
          : (entry.executable.path ?? 'your installed claude');
      return {
        title: entry.label,
        detail:
          `Via Claude Code (Agent SDK) on ${executable} · ${entry.model ?? 'claude-opus-5-5'}${effort}` +
          ` · ${entry.hasApiKey ? 'API key set' : 'no API key'}`,
      };
    }
    case 'openai-compatible': {
      return {
        title: entry.label,
        detail:
          `${entry.model} at ${entry.baseUrl} · ${entry.tools ? 'read-only tools' : 'no tools'}${effort}` +
          (entry.hasApiKey ? ' · API key set' : ''),
        ...(entry.isRemote && {
          warning: 'Not on this machine: the diff and your questions are sent to this server.',
        }),
      };
    }
  }
}
