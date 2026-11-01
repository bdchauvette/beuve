/** A file name in a repository-relative directory, where `''` is the top level. */
export interface PathInDirectory {
  readonly directory: string;
  readonly name: string;
}

/** `directory/name`, or `name` at the top level. */
export function joinPath({ directory, name }: PathInDirectory): string {
  if (directory === '') {
    return name;
  }
  return `${directory}/${name}`;
}
