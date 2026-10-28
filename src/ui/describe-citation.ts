import type { ChatCitationView } from '#contract/ipc-contract.ts';

/** How a citation pill reads: the file name and lines, with the full path as its tooltip. */
export function describeCitation(citation: ChatCitationView): { label: string; title: string } {
  const name = citation.path.split('/').at(-1) ?? citation.path;
  const lines =
    citation.startLine === citation.endLine
      ? String(citation.startLine)
      : `${String(citation.startLine)}-${String(citation.endLine)}`;
  return { label: `${name}:${lines}`, title: `${citation.path}:${lines}` };
}
