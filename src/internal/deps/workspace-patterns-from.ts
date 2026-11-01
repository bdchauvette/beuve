const lineBreak = /\r?\n/u;
const commentTail = /#.*$/u;
/** `  - value  # comment`: one item of a block list. */
const listItem = /^\s+-\s+(?<value>[^#]*[^#\s])/u;
const indented = /^\s/u;
const quotedValue = /^(?<quote>['"])(?<inner>.*)\k<quote>$/u;

/** A Node unit's manifests, as text, when the tree has them. */
export interface WorkspaceManifests {
  readonly packageJson: string | undefined;
  readonly pnpmWorkspace: string | undefined;
}

/**
 * A Node workspace root's member globs, in order (a leading `!` excludes): `packages` in
 * `pnpm-workspace.yaml` when there is one, else `workspaces` in `package.json` (an array, or
 * `{ packages: [...] }` as Yarn classic also allows). Malformed files give no members. The YAML
 * reader understands only the block list pnpm documents, which is all detection needs.
 */
export function workspacePatternsFrom({
  packageJson,
  pnpmWorkspace,
}: WorkspaceManifests): readonly string[] {
  if (pnpmWorkspace !== undefined) {
    return pnpmPackagesFrom(pnpmWorkspace);
  }
  if (packageJson === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(packageJson);
    if (typeof parsed !== 'object' || parsed === null) {
      return [];
    }
    let workspaces = (parsed as Record<string, unknown>)['workspaces'];
    if (typeof workspaces === 'object' && workspaces !== null && !Array.isArray(workspaces)) {
      workspaces = (workspaces as Record<string, unknown>)['packages'];
    }
    if (!Array.isArray(workspaces)) {
      return [];
    }
    return workspaces.filter((pattern): pattern is string => typeof pattern === 'string');
  } catch {
    return [];
  }
}

function pnpmPackagesFrom(text: string): readonly string[] {
  const patterns: string[] = [];
  let isInPackages = false;
  for (const line of text.split(lineBreak)) {
    if (line.replace(commentTail, '').trimEnd() === 'packages:') {
      isInPackages = true;
      continue;
    }
    if (!isInPackages || line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    const item = listItem.exec(line);
    if (item?.groups === undefined) {
      if (!indented.test(line)) {
        isInPackages = false;
      }
      continue;
    }
    patterns.push(unquoted(item.groups['value'] ?? ''));
  }
  return patterns;
}

function unquoted(value: string): string {
  const quoted = quotedValue.exec(value);
  return quoted?.groups?.['inner'] ?? value;
}
