/** The state of the file in the reviewer's own working tree. */
export type WorkingFileState = 'clean' | 'modified' | 'missing';

export interface EditorRootFacts {
  /** The commit checked out in the reviewer's working tree, if it could be read. */
  readonly workingTreeHead: string | undefined;
  readonly sessionHead: string;
  readonly workingFile: WorkingFileState;
}

/**
 * Which copy of the file to open (ADR 0033): the reviewer's own working tree only when it is at
 * the session head and the file there exists with no uncommitted changes, so line numbers match
 * the diff; otherwise beuve's head checkout (ADR 0020).
 */
export function chooseEditorRoot(facts: EditorRootFacts): 'working-tree' | 'beuve-checkout' {
  return facts.workingTreeHead === facts.sessionHead && facts.workingFile === 'clean'
    ? 'working-tree'
    : 'beuve-checkout';
}
