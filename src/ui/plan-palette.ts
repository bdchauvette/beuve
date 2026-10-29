import type {
  AgentInsightView,
  DiffFileView,
  SessionSummary,
  UraItemView,
} from '#contract/ipc-contract.ts';

import type { CommandDefinition } from './command-registry.ts';
import { findKnownClone } from './find-known-clone.ts';
import { fuzzyMatch } from './fuzzy-match.ts';
import { palettePrefixes } from './palette-prefixes.ts';
import type { PaletteGroup } from './palette-prefixes.ts';
import { parseOpenQuery } from './parse-open-query.ts';
import { shortenPath } from './shorten-path.ts';

/** The palette's sources, as `beuve-app` holds them. */
export interface PaletteSources {
  readonly commands: readonly CommandDefinition[];
  readonly sessions: readonly SessionSummary[];
  /** The open review's files, changed first in review order; absent with no session. */
  readonly files?: readonly DiffFileView[];
  /** Every tracked path at the head (`session:get-tree`). */
  readonly trackedPaths?: readonly string[];
  readonly uraItems: readonly UraItemView[];
  readonly insights: readonly AgentInsightView[];
}

export type PaletteAction =
  | { readonly kind: 'command'; readonly command: CommandDefinition }
  | { readonly kind: 'session'; readonly sessionId: string }
  /** `repoPath` absent: ask for the clone in the open dialog's pull request step. */
  | { readonly kind: 'open-pull'; readonly ref: string; readonly repoPath?: string }
  | { readonly kind: 'open-step'; readonly step: 'pull' | 'local'; readonly path?: string }
  | { readonly kind: 'file'; readonly path: string; readonly isChanged: boolean }
  | { readonly kind: 'ura-item'; readonly itemId: string }
  | { readonly kind: 'insight'; readonly insightId: string };

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

const mixedLimit = 5;
const groupLimit = 60;
const groupOrder: readonly PaletteGroup[] = ['open', 'files', 'review', 'commands'];

/**
 * Ranks the palette's entries for `input`. `>` lists commands, `@` files (changed ones first,
 * then the rest of the tree), `#` recent sessions and open actions, `!` staged review items and
 * agent insights; no prefix mixes the four groups, a few of each. A pasted pull request link
 * or folder path comes first in either `#` or mixed mode. Fuzzy-matched on titles (files on their
 * paths); ties keep each source's own order. Pure.
 */
export function planPalette(input: string, sources: PaletteSources): PaletteEntry[] {
  const prefix = input.trimStart().charAt(0);
  const only = palettePrefixes[prefix];
  const text = (only === undefined ? input : input.trimStart().slice(1)).trim();
  const groups = only === undefined ? groupOrder : [only];
  const limit = only === undefined ? mixedLimit : groupLimit;
  return groups.flatMap((group) => rank(candidates(group, text, sources), text, limit));
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
      const match = fuzzyMatch(text, candidate.searchText ?? candidate.entry.title);
      const isTitle =
        candidate.searchText === undefined || candidate.searchText === candidate.entry.title;
      return match === undefined
        ? undefined
        : {
            entry: { ...candidate.entry, matches: isTitle ? match.indices : [] },
            score: match.score,
            order,
          };
    })
    .filter((scoredEntry) => scoredEntry !== undefined);
  return scored
    .toSorted((a, b) => (text === '' ? a.order - b.order : b.score - a.score || a.order - b.order))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function candidates(group: PaletteGroup, text: string, sources: PaletteSources): Candidate[] {
  switch (group) {
    case 'commands': {
      return commandCandidates(sources.commands);
    }
    case 'open': {
      return openCandidates(text, sources.sessions);
    }
    case 'files': {
      return fileCandidates(sources.files ?? [], sources.trackedPaths ?? []);
    }
    case 'review': {
      return reviewCandidates(sources.uraItems, sources.insights);
    }
  }
}

function commandCandidates(commands: readonly CommandDefinition[]): Candidate[] {
  return commands
    .filter((command) => command.available && command.id !== 'palette')
    .map((command) => ({
      entry: {
        id: `command:${command.id}`,
        group: 'commands',
        title: command.title,
        ...(command.scope !== 'Anywhere' && { detail: command.scope }),
        keys:
          command.keys.length > 0
            ? command.keys
            : command.slash === undefined
              ? []
              : [command.slash],
        action: { kind: 'command', command },
      },
    }));
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
        detail: repoPath === undefined ? 'choose the local clone' : `into ${shortenPath(repoPath)}`,
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
  return parsed.kind === 'pull-request' || parsed.kind === 'path' ? pasted : [...recent, ...steps];
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
  const changedCandidates = files.map((file): Candidate => ({
    searchText: file.path,
    entry: {
      id: `file:${file.path}`,
      group: 'files',
      title: file.path,
      detail: `${file.status} · +${String(file.additions)} −${String(file.deletions)}`,
      action: { kind: 'file', path: file.path, isChanged: true },
    },
  }));
  const others = trackedPaths
    .filter((path) => !changed.has(path))
    .map((path): Candidate => ({
      searchText: path,
      entry: {
        id: `file:${path}`,
        group: 'files',
        title: path,
        detail: 'unchanged',
        action: { kind: 'file', path, isChanged: false },
      },
    }));
  return [...changedCandidates, ...others];
}

function reviewCandidates(
  items: readonly UraItemView[],
  insights: readonly AgentInsightView[],
): Candidate[] {
  const staged = items
    .filter((item) => item.status.kind === 'staged')
    .map((item): Candidate => ({
      entry: {
        id: `ura:${item.id}`,
        group: 'review',
        title: item.title === '' ? '(untitled note)' : item.title,
        detail: `staged ${item.severity}`,
        action: { kind: 'ura-item', itemId: item.id },
      },
    }));
  const pending = insights
    .filter((insight) => insight.status !== 'dismissed')
    .map((insight): Candidate => ({
      entry: {
        id: `insight:${insight.id}`,
        group: 'review',
        title: insight.title,
        detail: `insight · ${insight.path}:${String(insight.lineStart)}`,
        action: { kind: 'insight', insightId: insight.id },
      },
    }));
  return [...staged, ...pending];
}
