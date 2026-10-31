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
  if (target?.file.kind !== 'workspace') {
    const named = tokenName(definition);
    const [outside] = definition.targets;
    if (outside?.file.kind === 'external') {
      return `${named} is defined outside the repository (${outside.file.uri}).`;
    }
    return `The language server knows no definition for ${named}.`;
  }
  const { file, ...range } = target;
  return { sessionId, sha: definition.sha, path: file.path, range };
}

function tokenName(definition: DefinitionView): string {
  if (definition.token === undefined) {
    return 'this line';
  }
  return `“${definition.token.text}”`;
}
