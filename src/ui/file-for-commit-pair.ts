import type { DiffFileView, FileAttributionView } from '#contract/ipc-contract.ts';

import { linesOf } from './lines-of.ts';

/**
 * `file` narrowed to what commit pair `pairId` produced (ADR 0054): the hunks its new commit
 * wrote, with the patch and counts rebuilt from them. `undefined` when the pair never touched
 * the file. A file the pair touched without a hunk of its own (a binary, a mode change, lines a
 * later commit rewrote) is kept whole, so nothing it touched disappears. Pure.
 */
export function fileForCommitPair(
  file: DiffFileView,
  attribution: FileAttributionView | undefined,
  pairId: string,
): DiffFileView | undefined {
  if (attribution?.pairIds.includes(pairId) !== true) {
    return undefined;
  }
  const kept = file.hunks
    .map((_hunk, index) => index)
    .filter((index) => attribution.hunkPairIds[index]?.includes(pairId) === true);
  if (kept.length === 0 || kept.length === file.hunks.length) {
    return file;
  }
  const { header, sections } = splitHunkSections(file.patch);
  const lines = kept.flatMap((index) => {
    return sections[index] ?? [];
  });
  const body = lines.filter((line) => !line.startsWith('@@'));
  return {
    ...file,
    hunks: kept.flatMap((index) => {
      return file.hunks[index] ?? [];
    }),
    patch: `${[...header, ...lines].join('\n')}\n`,
    additions: body.filter((line) => line.startsWith('+')).length,
    deletions: body.filter((line) => line.startsWith('-')).length,
  };
}

/** A patch's lines before the first `@@`, and each hunk's lines from its `@@` on. */
interface HunkSections {
  readonly header: string[];
  readonly sections: string[][];
}

function splitHunkSections(patch: string): HunkSections {
  const lines = linesOf(patch);
  const header: string[] = [];
  const sections: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) {
      sections.push([line]);
    } else {
      (sections.at(-1) ?? header).push(line);
    }
  }
  return { header, sections };
}
