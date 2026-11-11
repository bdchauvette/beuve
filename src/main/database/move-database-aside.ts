import { link, unlink } from 'node:fs/promises';

/** A database file set aside, from where it was to where it is now. */
export interface MovedFile {
  readonly from: string;
  readonly to: string;
}

/** Where a database went: its main file's new path, and every file that moved with it. */
export interface MovedDatabase {
  /** `<location>.reset-<time>`, which opens as the old database. */
  readonly path: string;
  /** The main file first, then its `-wal` and `-shm` when there were any. */
  readonly files: readonly MovedFile[];
}

/**
 * Moves the closed SQLite database at `location` aside to `<location>.reset-<time>` (with `-2`,
 * `-3`, … when that name is taken), its `-wal` and `-shm` beside it under the same name, so the
 * copy opens with everything committed to it. Nothing is deleted or overwritten: each file is
 * hard-linked to its new name first, and the old names are unlinked only once every link exists,
 * the main file last. Answers `undefined`, and moves nothing, when there is no file at `location`.
 * The caller closes every connection first.
 */
export async function moveDatabaseAside(location: string): Promise<MovedDatabase | undefined> {
  const stamp = timestamp();
  for (let attempt = 1; ; attempt += 1) {
    const aside = asideName({ location, stamp, attempt });
    const linked = await linkUnlessTaken({ from: location, to: aside });
    if (linked === 'missing') {
      return undefined;
    }
    if (linked === 'taken') {
      continue;
    }
    const files: MovedFile[] = [{ from: location, to: aside }];
    for (const suffix of companionSuffixes) {
      const companion = { from: `${location}${suffix}`, to: `${aside}${suffix}` };
      const outcome = await linkUnlessTaken(companion);
      if (outcome === 'taken') {
        throw new Error(`${companion.to} already exists`);
      }
      if (outcome === 'linked') {
        files.push(companion);
      }
    }
    // The companions go before the main file: a `-wal` left beside a new `beuve.db` would be
    // read as that database's.
    for (const file of files.toReversed()) {
      await unlink(file.from);
    }
    return { path: aside, files };
  }
}

/** SQLite's write-ahead log and its shared-memory index, which belong to the main file. */
const companionSuffixes = ['-wal', '-shm'];

/** `2026-11-11T161530Z`: sortable, and without the colons some file systems refuse. */
function timestamp(): string {
  return Temporal.Now.instant().toString({ smallestUnit: 'second' }).replaceAll(':', '');
}

/** The database, the time it is moved at, and which try this is. */
interface AsideCandidate {
  readonly location: string;
  readonly stamp: string;
  readonly attempt: number;
}

function asideName({ location, stamp, attempt }: AsideCandidate): string {
  if (attempt === 1) {
    return `${location}.reset-${stamp}`;
  }
  return `${location}.reset-${stamp}-${String(attempt)}`;
}

async function linkUnlessTaken(file: MovedFile): Promise<'linked' | 'taken' | 'missing'> {
  try {
    await link(file.from, file.to);
    return 'linked';
  } catch (error: unknown) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'EEXIST') {
      return 'taken';
    }
    if (code === 'ENOENT') {
      return 'missing';
    }
    throw error;
  }
}
