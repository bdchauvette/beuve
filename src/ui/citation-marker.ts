import type { ChatCitationView } from '#contract/ipc-contract.ts';

/** The exact marker a citation is written as in a validated answer (ADR 0031). */
export function citationMarker(citation: ChatCitationView): string {
  return `[[${citation.path}:${String(citation.startLine)}-${String(citation.endLine)}]]`;
}
