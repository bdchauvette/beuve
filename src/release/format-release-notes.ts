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
const breakingMark = /!$/;
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
    if (lines.length === 0) {
      return [];
    }
    return `## ${title}\n\n${lines.join('\n')}`;
  });
  let body = 'No user-facing changes.';
  if (sections.length > 0) {
    body = sections.join('\n\n');
  }
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
  const prefix = commit.subject.slice(0, split);
  const isBreaking = prefix.endsWith('!');
  const header = parseHeader(prefix.replace(breakingMark, ''));
  if (text === '' || header === undefined || !typePattern.test(header.type)) {
    return other;
  }
  const { type, scope } = header;
  let line = `${text} (${commit.hash})`;
  if (groupTitle(type) === otherTitle) {
    line = `${type}: ${line}`;
  }
  if (scope !== undefined) {
    line = `**${scope}:** ${line}`;
  }
  if (isBreaking) {
    line = `**BREAKING** ${line}`;
  }
  return { type, line };
}

interface Header {
  readonly type: string;
  /** What the parentheses hold; `undefined` without them. */
  readonly scope: string | undefined;
}

/** `type` or `type(scope)`; `undefined` for an unclosed scope. */
function parseHeader(header: string): Header | undefined {
  const open = header.indexOf('(');
  if (open === -1) {
    return { type: header, scope: undefined };
  }
  if (!header.endsWith(')')) {
    return undefined;
  }
  return { type: header.slice(0, open), scope: header.slice(open + 1, -1) };
}

function groupTitle(type: string): string {
  return groups.find((group) => group.types.includes(type))?.title ?? otherTitle;
}

function footer(input: ReleaseNotesInput): string {
  const { repository } = input;
  const base = `https://github.com/${repository}`;
  const lines = [
    changelogLine(input),
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

function changelogLine({ repository, version, previousTag }: ReleaseNotesInput): string {
  if (previousTag === undefined) {
    return 'First release.';
  }
  return `**Full changelog:** https://github.com/${repository}/compare/${previousTag}...v${version}`;
}
