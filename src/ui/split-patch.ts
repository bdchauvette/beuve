/** How a line of a unified diff renders. */
export type PatchLineKind = 'meta' | 'hunk' | 'added' | 'removed' | 'context' | 'note';

export interface PatchLine {
  readonly kind: PatchLineKind;
  readonly text: string;
}

/**
 * Splits one file's patch into classified lines. Everything before the first `@@` is the file
 * header (`diff --git`, `index`, `---`, `+++`), so `---`/`+++` there never count as changes.
 */
export function splitPatch(patch: string): PatchLine[] {
  const texts = patch.endsWith('\n') ? patch.slice(0, -1).split('\n') : patch.split('\n');
  let isInHunk = false;
  return texts.map((text): PatchLine => {
    if (text.startsWith('@@')) {
      isInHunk = true;
      return { kind: 'hunk', text };
    }
    return { kind: isInHunk ? hunkLineKind(text) : 'meta', text };
  });
}

function hunkLineKind(text: string): PatchLineKind {
  switch (text[0]) {
    case '+': {
      return 'added';
    }
    case '-': {
      return 'removed';
    }
    case '\\': {
      return 'note';
    }
    default: {
      return 'context';
    }
  }
}
