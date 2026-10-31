import type { DiffFileView, SessionSummary, UraItemView } from '#contract/ipc-contract.ts';

import { acceleratorsFor } from '#contract/accelerators-for.ts';
import type { KeyPlatform } from '#contract/command-catalog.ts';

import type { CommandDefinition } from './command-registry.ts';
import { displayAccelerator } from './display-accelerator.ts';
import { findKnownClone } from './find-known-clone.ts';
import { fuzzyMatch } from './fuzzy-match.ts';
import { palettePrefixes } from './palette-prefixes.ts';
import type { PaletteGroup } from './palette-prefixes.ts';
import { parseOpenQuery } from './parse-open-query.ts';
import { shortenPath } from './shorten-path.ts';

/** The palette's sources, as `beuve-app` holds them. */
export interface PaletteSources {
  readonly commands: readonly CommandDefinition[];
  /** Whose keys the commands show. */
  readonly platform: KeyPlatform;
  readonly sessions: readonly SessionSummary[];
  /** The open review's files, changed first in review order; absent with no session. */
  readonly files?: readonly DiffFileView[];
  /** Every tracked path at the head (`session:get-tree`). */
  readonly trackedPaths?: readonly string[];
  readonly uraItems: readonly UraItemView[];
}

export type PaletteAction =
  | { readonly kind: 'command'; readonly command: CommandDefinition }
  | { readonly kind: 'session'; readonly sessionId: string }
  /** `repoPath` absent: ask for the clone in the open dialog's pull request step. */
  | { readonly kind: 'open-pull'; readonly ref: string; readonly repoPath?: string }
  | { readonly kind: 'open-step'; readonly step: 'pull' | 'local'; readonly path?: string }
  | { readonly kind: 'file'; readonly path: string; readonly isChanged: boolean }
  | { readonly kind: 'ura-item'; readonly itemId: string };

export interface PaletteEntry {
  readonly id: string;
  readonly group: PaletteGroup;
  readonly title: string;
  readonly detail?: string;
  /** Shortcut or usage shown on the right. */
  readonly keys?: readonly string[];
  /** Matched character positions in `title`, for highlighting. */
  readonly matches: readonly number[];
  readonly action: PaletteAction;
}

const menuNames: Readonly<Record<string, string>> = {
  file: 'File',
  edit: 'Edit',
  view: 'View',
  go: 'Go',
  review: 'Review',
  chat: 'Chat',
  window: 'Window',
  help: 'Help',
};

const mixedLimit = 5;
const groupLimit = 60;
const groupOrder: readonly PaletteGroup[] = ['open', 'files', 'review', 'commands'];

/**
 * Ranks the palette's entries for `input`. `>` lists commands, `@` files (changed ones first,
 * then the rest of the tree), `#` recent sessions and open actions, `!` staged review items; no prefix mixes the four groups, a few of each. A pasted pull request link
 * or folder path comes first in either `#` or mixed mode. Fuzzy-matched on titles (files on their
 * paths); ties keep each source's own order. Pure.
 */
export function planPalette(input: string, sources: PaletteSources): PaletteEntry[] {
  const prefix = input.trimStart().charAt(0);
  const only = palettePrefixes[prefix];
  if (only === undefined) {
    const text = input.trim();
    return groupOrder.flatMap((group) => {
      return rank(candidates(group, text, sources), text, mixedLimit);
    });
  }
  const text = input.trimStart().slice(1).trim();
  return rank(candidates(only, text, sources), text, groupLimit);
}

interface Candidate {
  readonly entry: Omit<PaletteEntry, 'matches'>;
  /** Searched instead of the title, e.g. a file's whole path. */
  readonly searchText?: string;
  /** Always shown first, unfiltered (a pasted link). */
  readonly pinned?: boolean;
}

function rank(candidates: readonly Candidate[], text: string, limit: number): PaletteEntry[] {
  const scored = candidates
    .map((candidate, order) => {
      if (candidate.pinned === true) {
        return { entry: { ...candidate.entry, matches: [] }, score: Infinity, order };
      }
      const match = fuzzyMatch({
        query: text,
        text: candidate.searchText ?? candidate.entry.title,
      });
      if (match === undefined) {
        return;
      }
      const isTitle =
        candidate.searchText === undefined || candidate.searchText === candidate.entry.title;
      let matches: readonly number[] = [];
      if (isTitle) {
        matches = match.indices;
      }
      return { entry: { ...candidate.entry, matches }, score: match.score, order };
    })
    .filter((scoredEntry) => scoredEntry !== undefined);
  return scored
    .toSorted((a, b) => {
      if (text === '') {
        return a.order - b.order;
      }
      return b.score - a.score || a.order - b.order;
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function candidates(group: PaletteGroup, text: string, sources: PaletteSources): Candidate[] {
  switch (group) {
    case 'commands': {
      return commandCandidates(sources.commands, sources.platform);
    }
    case 'open': {
      return openCandidates(text, sources.sessions);
    }
    case 'files': {
      return fileCandidates(sources.files ?? [], sources.trackedPaths ?? []);
    }
    case 'review': {
      return reviewCandidates(sources.uraItems);
    }
  }
}

function commandCandidates(
  commands: readonly CommandDefinition[],
  platform: KeyPlatform,
): Candidate[] {
  return commands
    .filter((command) => command.run.kind !== 'none' && command.id !== 'palette')
    .map((command) => {
      const keys = commandKeys(command, platform);
      const menu = command.menu?.menu;
      return {
        entry: {
          id: `command:${command.id}`,
          group: 'commands',
          title: command.title,
          ...(menu !== undefined && menu !== 'app' && { detail: menuNames[menu] }),
          keys,
          action: { kind: 'command', command },
        },
      };
    });
}

/** The command's first shortcut, else its slash command, as the palette row shows it. */
function commandKeys(command: CommandDefinition, platform: KeyPlatform): string[] {
  const [key] = acceleratorsFor(command, platform);
  if (key !== undefined) {
    return [displayAccelerator(key, platform)];
  }
  if (command.slash !== undefined) {
    return [command.slash];
  }
  return [];
}

function openCandidates(text: string, sessions: readonly SessionSummary[]): Candidate[] {
  const parsed = parseOpenQuery(text);
  const pasted: Candidate[] = [];
  if (parsed.kind === 'pull-request') {
    const repoPath = findKnownClone(sessions, parsed);
    pasted.push({
      pinned: true,
      entry: {
        id: 'open:pasted-pull',
        group: 'open',
        title: `Open ${parsed.owner}/${parsed.repo}#${String(parsed.number)}`,
        detail: cloneDetail(repoPath),
        action: { kind: 'open-pull', ref: parsed.ref, ...(repoPath !== undefined && { repoPath }) },
      },
    });
  } else if (parsed.kind === 'path') {
    pasted.push({
      pinned: true,
      entry: {
        id: 'open:pasted-path',
        group: 'open',
        title: `Review a branch in ${parsed.path}`,
        action: { kind: 'open-step', step: 'local', path: parsed.path },
      },
    });
  }
  if (parsed.kind === 'pull-request' || parsed.kind === 'path') {
    return pasted;
  }
  const recent = sessions
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((session): Candidate => sessionCandidate(session));
  const steps: Candidate[] = [
    {
      entry: {
        id: 'open:pull',
        group: 'open',
        title: 'Open pull request…',
        detail: 'link or owner/repo#n',
        action: { kind: 'open-step', step: 'pull' },
      },
    },
    {
      entry: {
        id: 'open:local',
        group: 'open',
        title: 'Open local branch…',
        detail: 'folder, head and base',
        action: { kind: 'open-step', step: 'local' },
      },
    },
  ];
  return [...recent, ...steps];
}

function cloneDetail(repoPath: string | undefined): string {
  if (repoPath === undefined) {
    return 'choose the local clone';
  }
  return `into ${shortenPath(repoPath)}`;
}

function sessionCandidate(session: SessionSummary): Candidate {
  const { source } = session;
  const folder = source.repoPath.split('/').findLast((part) => part !== '') ?? source.repoPath;
  if (source.kind === 'github-pull-request') {
    const number = `#${String(source.number)}`;
    const title = session.pullRequest?.title ?? `${source.owner}/${source.repo}`;
    return {
      searchText: `${number} ${title} ${source.owner}/${source.repo}`,
      entry: {
        id: `session:${session.id}`,
        group: 'open',
        title: `${number} ${title}`,
        detail: `${source.owner}/${source.repo} · ${folder}`,
        action: { kind: 'session', sessionId: session.id },
      },
    };
  }
  return {
    searchText: `${folder} ${source.headRef} ${source.baseRef}`,
    entry: {
      id: `session:${session.id}`,
      group: 'open',
      title: `${folder} ${source.headRef}`,
      detail: `against ${source.baseRef} · local branch`,
      action: { kind: 'session', sessionId: session.id },
    },
  };
}

function fileCandidates(
  files: readonly DiffFileView[],
  trackedPaths: readonly string[],
): Candidate[] {
  const changed = new Set(files.map((file) => file.path));
  const changedCandidates = files.map((file): Candidate => {
    return {
      searchText: file.path,
      entry: {
        id: `file:${file.path}`,
        group: 'files',
        title: file.path,
        detail: `${file.status} · +${String(file.additions)} −${String(file.deletions)}`,
        action: { kind: 'file', path: file.path, isChanged: true },
      },
    };
  });
  const others = trackedPaths
    .filter((path) => !changed.has(path))
    .map((path): Candidate => {
      return {
        searchText: path,
        entry: {
          id: `file:${path}`,
          group: 'files',
          title: path,
          detail: 'unchanged',
          action: { kind: 'file', path, isChanged: false },
        },
      };
    });
  return [...changedCandidates, ...others];
}

function reviewCandidates(items: readonly UraItemView[]): Candidate[] {
  return items
    .filter((item) => item.status.kind === 'staged')
    .map((item): Candidate => {
      return {
        entry: {
          id: `ura:${item.id}`,
          group: 'review',
          title: noteTitle(item),
          detail: `staged ${item.severity}`,
          action: { kind: 'ura-item', itemId: item.id },
        },
      };
    });
}

function noteTitle(item: UraItemView): string {
  if (item.title === '') {
    return '(untitled note)';
  }
  return item.title;
}
