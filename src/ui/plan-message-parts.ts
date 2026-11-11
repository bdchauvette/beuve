import type { ChatPartView } from '#contract/ipc-contract.ts';

import { nounFor } from './noun-for.ts';

/** Reasoning and tool-call parts, shown together as what the model did. */
export type StepPart = Extract<ChatPartView, { kind: 'reasoning' | 'tool-call' }>;

/** One block of a rendered message: a part, or a run of steps with its one-line label. */
export type MessageBlock =
  | { readonly kind: 'part'; readonly part: Exclude<ChatPartView, StepPart> }
  | { readonly kind: 'steps'; readonly parts: readonly StepPart[]; readonly label: string };

/**
 * How the drawer lays out a message's parts (ADR 0072): in order, with each run of reasoning and
 * tool calls as one `steps` block labeled `Thought · 3 tool calls (1 failed)`, so a finished
 * answer can fold what the model did into one line. Pure.
 */
export function planMessageParts(parts: readonly ChatPartView[]): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let steps: StepPart[] = [];
  const flush = (): void => {
    if (steps.length === 0) {
      return;
    }

    blocks.push({ kind: 'steps', parts: steps, label: labelOf(steps) });
    steps = [];
  };
  for (const part of parts) {
    if (part.kind === 'reasoning' || part.kind === 'tool-call') {
      steps.push(part);
    } else {
      flush();
      blocks.push({ kind: 'part', part });
    }
  }
  flush();
  return blocks;
}

function labelOf(steps: readonly StepPart[]): string {
  const tools = steps.filter((part) => part.kind === 'tool-call');
  const failed = tools.filter((part) => part.state === 'failed').length;
  const labels: string[] = [];
  if (steps.some((part) => part.kind === 'reasoning')) {
    labels.push('Thought');
  }
  if (tools.length > 0) {
    const calls = `${String(tools.length)} tool ${nounFor(tools.length, 'call')}`;
    if (failed === 0) {
      labels.push(calls);
    } else {
      labels.push(`${calls} (${String(failed)} failed)`);
    }
  }
  return labels.join(' · ');
}
