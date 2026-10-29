export interface ReleaseCommit {
  readonly hash: string;
  readonly subject: string;
}

export interface ReleaseNotesInput {
  readonly repository: string;
  readonly version: string;
  /** Tag of the previous release; `undefined` for the first one. */
  readonly previousTag: string | undefined;
  readonly commits: readonly ReleaseCommit[];
}

interface Group {
  readonly title: string;
  readonly types: readonly string[];
}

const groups: readonly Group[] = [
  { title: 'Features', types: ['feat'] },
  { title: 'Fixes', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
  { title: 'Refactoring', types: ['refactor'] },
  { title: 'Documentation', types: ['docs'] },
];
const otherTitle = 'Other changes';
const typePattern = /^[a-z]+$/;
const caskBumpPrefix = 'chore(cask):';

/**
 * Release notes in Markdown from conventional-commit subjects, newest first: Features, Fixes,
 * Performance, Refactoring, Documentation, then everything else (including subjects that aren't
 * conventional). Cask bump commits are left out. Breaking changes (`type!:`) are marked.
 */
export function formatReleaseNotes(input: ReleaseNotesInput): string {
  const entries = input.commits
    .filter((commit) => !commit.subject.startsWith(caskBumpPrefix))
    .map((commit) => parseEntry(commit));
  const titles = [...groups.map((group) => group.title), otherTitle];
  const sections = titles.flatMap((title) => {
    const lines = entries
      .filter((entry) => groupTitle(entry.type) === title)
      .map((entry) => `- ${entry.line}`);
    return lines.length === 0 ? [] : `## ${title}\n\n${lines.join('\n')}`;
  });
  const body = sections.length === 0 ? 'No user-facing changes.' : sections.join('\n\n');
  return `${body}\n\n${footer(input)}\n`;
}

interface Entry {
  readonly type: string;
  readonly line: string;
}

function parseEntry(commit: ReleaseCommit): Entry {
  const other: Entry = { type: 'other', line: `${commit.subject} (${commit.hash})` };
  const split = commit.subject.indexOf(': ');
  if (split === -1) {
    return other;
  }
  const text = commit.subject.slice(split + 2);
  const isBreaking = commit.subject.slice(0, split).endsWith('!');
  const header = commit.subject.slice(0, isBreaking ? split - 1 : split);
  const open = header.indexOf('(');
  const type = open === -1 ? header : header.slice(0, open);
  if (text === '' || !typePattern.test(type) || (open !== -1 && !header.endsWith(')'))) {
    return other;
  }
  const scope = open === -1 ? '' : `**${header.slice(open + 1, -1)}:** `;
  const label = groupTitle(type) === otherTitle ? `${type}: ` : '';
  const breaking = isBreaking ? '**BREAKING** ' : '';
  return { type, line: `${breaking}${scope}${label}${text} (${commit.hash})` };
}

function groupTitle(type: string): string {
  return groups.find((group) => group.types.includes(type))?.title ?? otherTitle;
}

function footer(input: ReleaseNotesInput): string {
  const { repository, version, previousTag } = input;
  const base = `https://github.com/${repository}`;
  const lines = [
    previousTag === undefined
      ? `First release.`
      : `**Full changelog:** ${base}/compare/${previousTag}...v${version}`,
    '',
    '## Install',
    '',
    'Apple silicon, macOS 13 or later. The app is ad-hoc signed and not notarized, so Gatekeeper blocks a downloaded copy until you clear its quarantine attribute (docs/packaging.md). Verify downloads against `SHA256SUMS`.',
    '',
    '```sh',
    `brew tap ${repository} ${base}`,
    'brew install --cask beuve',
    '```',
  ];
  return lines.join('\n');
}
