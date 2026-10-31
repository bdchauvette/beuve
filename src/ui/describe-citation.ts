import type { ChatCitationView } from '#contract/ipc-contract.ts';

/** A citation pill's text and tooltip. */
export interface CitationLabels {
  readonly label: string;
  readonly title: string;
}

/** How a citation pill reads: the file name and lines, with the full path as its tooltip. */
export function describeCitation(citation: ChatCitationView): CitationLabels {
  const name = citation.path.split('/').at(-1) ?? citation.path;
  const lines = linesOf(citation);
  return { label: `${name}:${lines}`, title: `${citation.path}:${lines}` };
}

/** `12`, or `12-15` for a range. */
function linesOf(citation: ChatCitationView): string {
  if (citation.startLine === citation.endLine) {
    return String(citation.startLine);
  }
  return `${String(citation.startLine)}-${String(citation.endLine)}`;
}
