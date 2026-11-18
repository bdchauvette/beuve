/** What {@link editableDiffFrom} reads of a parsed diff (`@pierre/diffs`' `FileDiffMetadata`). */
export interface EditableDiff {
  readonly name: string;
  readonly type: string;
  readonly isPartial: boolean;
  readonly cacheKey?: string | undefined;
  readonly lang?: string | undefined;
}

/** A file by name, with its text. */
export interface NamedText {
  readonly name: string;
  readonly contents: string;
}

/** How {@link editableDiffFrom} asks the library to parse a patch with both its files. */
export interface CompleteParse {
  readonly isGitDiff: boolean;
  readonly oldFile: NamedText;
  readonly newFile: NamedText;
  readonly cacheKey?: string;
}

/** The part of `@pierre/diffs` {@link editableDiffFrom} parses with (ADR 0018: only the card imports it). */
export interface EditableDiffLibrary<T> {
  processFile(patch: string, options: CompleteParse): T | undefined;
}

/** A card's parsed diff, the patch it parsed, and the head file Suggest Edit loaded. */
export interface EditableDiffInput<T> {
  readonly library: EditableDiffLibrary<T>;
  readonly shown: T;
  readonly patch: string;
  readonly head: string;
}

/**
 * The diff Suggest Edit attaches `@pierre/diffs/edit` to (ADR 0043). The card parses each patch
 * without its files, so its diffs are partial. `FileDiff.prepareForEditing` hydrates a changed
 * or renamed file through `loadDiffFiles`, but refuses an added one ("this partial diff cannot
 * be hydrated"); for that, this is the complete diff of the same patch with an empty base and
 * `head` as the new side, as the library parses a new file from both its contents. It keeps the
 * shown diff's language, and takes a cache key of its own: the library keys renders by it, and
 * the card renders `shown` again once the edit ends. Any other diff comes back as it is.
 */
export function editableDiffFrom<T extends EditableDiff>({
  library,
  shown,
  patch,
  head,
}: EditableDiffInput<T>): T {
  if (!shown.isPartial || shown.type !== 'new') {
    return shown;
  }
  const complete = library.processFile(patch, {
    isGitDiff: true,
    oldFile: { name: shown.name, contents: '' },
    newFile: { name: shown.name, contents: head },
    ...(shown.cacheKey !== undefined && { cacheKey: `${shown.cacheKey}\0editable` }),
  });
  if (complete === undefined) {
    return shown;
  }
  return { ...complete, ...(shown.lang !== undefined && { lang: shown.lang }) };
}
