/** A file of the reviewed tree, as `git ls-tree -r` lists it. */
export interface TreeEntry {
  /** Repository-relative, `/`-separated. */
  readonly path: string;
  /** `100644`, `100755` or `120000` (a link). */
  readonly mode: string;
}
