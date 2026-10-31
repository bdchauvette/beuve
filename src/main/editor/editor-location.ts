/** A place to open in an editor: an absolute path and a 1-based line and column. */
export interface EditorLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
