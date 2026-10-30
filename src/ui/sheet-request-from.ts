import type { DefinitionView, OpenSheetRequest } from '#contract/ipc-contract.ts';

/**
 * The sheet a definition jump opens (ADR 0067): the first answer inside the repository, at the
 * commit the answer is for, highlighting its range. A message for the status bar when the server
 * knows no definition or only ones outside the repository (library typings). Pure.
 */
export function sheetRequestFrom(
  sessionId: string,
  definition: DefinitionView,
): OpenSheetRequest | string {
  const target = definition.targets.find((candidate) => candidate.file.kind === 'workspace');
  const named = definition.token === undefined ? 'this line' : `“${definition.token.text}”`;
  if (target?.file.kind !== 'workspace') {
    const [outside] = definition.targets;
    return outside?.file.kind === 'external'
      ? `${named} is defined outside the repository (${outside.file.uri}).`
      : `The language server knows no definition for ${named}.`;
  }
  const { file, ...range } = target;
  return { sessionId, sha: definition.sha, path: file.path, range };
}
