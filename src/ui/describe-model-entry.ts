import type { ModelEntryView, ModelExecutableView } from '#contract/ipc-contract.ts';

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
  const effort: string[] = [];
  if (entry.effort !== undefined) {
    effort.push(`effort ${entry.effort}`);
  }
  switch (entry.kind) {
    case 'claude-code-cli': {
      const parts = ['Runs Claude Code with your login', entry.model ?? 'its default model'];
      return { title: entry.label, detail: [...parts, ...effort].join(' · ') };
    }
    case 'claude-agent-sdk': {
      const parts = [
        `Via Claude Code (Agent SDK) on ${executableOf(entry.executable)}`,
        entry.model ?? 'claude-opus-5-5',
        ...effort,
      ];
      if (entry.hasApiKey) {
        parts.push('API key set');
      } else {
        parts.push('no API key');
      }
      return { title: entry.label, detail: parts.join(' · ') };
    }
    case 'openai-compatible': {
      const parts = [`${entry.model} at ${entry.baseUrl}`];
      if (entry.tools) {
        parts.push('read-only tools');
      } else {
        parts.push('no tools');
      }
      parts.push(...effort);
      if (entry.hasApiKey) {
        parts.push('API key set');
      }
      return {
        title: entry.label,
        detail: parts.join(' · '),
        ...(entry.isRemote && {
          warning: 'Not on this machine: the diff and your questions are sent to this server.',
        }),
      };
    }
  }
}

function executableOf(executable: ModelExecutableView): string {
  if (executable.source === 'bundled') {
    return 'bundled Claude Code';
  }
  return executable.path ?? 'your installed claude';
}
