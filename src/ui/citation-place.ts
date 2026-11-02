import type { ChatCitationView } from '#contract/ipc-contract.ts';

/** A citation's place as `path:start` or `path:start-end`, for notices. */
export function citationPlace(citation: ChatCitationView): string {
  const { path, startLine, endLine } = citation;
  let lines = String(startLine);
  if (startLine !== endLine) {
    lines += `-${String(endLine)}`;
  }
  return `${path}:${lines}`;
}
