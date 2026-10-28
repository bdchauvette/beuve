import { buildAgentReview } from './build-agent-review.ts';
import type { AgentReview, AgentReviewAnchor, AgentReviewItem } from './build-agent-review.ts';
import type { UraArtifact } from './ura-artifact.ts';
import { uraSeverities } from './ura-severities.ts';

const indent = '  ';

/**
 * The agent payload as an XML document: the same data as {@link buildAgentReview}, with titles
 * escaped and bodies and patches in CDATA sections (any `]]>` split across two). Characters XML
 * can't represent become U+FFFD. Pure and deterministic; it carries data, never instructions.
 */
export function renderAgentReviewXml(artifact: UraArtifact): string {
  const review = buildAgentReview(artifact);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<beuve-review${attributes({ schema: review.schema, verdict: review.verdict, 'verdict-source': review.verdictSource })}>`,
    ...changeElement(review).map((line) => indent + line),
    `${indent}<counts${attributes(Object.fromEntries(uraSeverities.map((severity) => [severity, review.counts[severity]])))}/>`,
    review.items.length === 0 ? `${indent}<items/>` : `${indent}<items>`,
    ...review.items.flatMap((item) => itemElement(item).map((line) => indent.repeat(2) + line)),
    ...(review.items.length === 0 ? [] : [`${indent}</items>`]),
    '</beuve-review>',
  ];
  return `${lines.join('\n')}\n`;
}

function changeElement(review: AgentReview): string[] {
  const { change } = review;
  const { repository } = change;
  const repositoryAttributes =
    repository.kind === 'local'
      ? {
          kind: repository.kind,
          path: repository.path,
          'base-ref': repository.baseRef,
          'head-ref': repository.headRef,
        }
      : {
          kind: repository.kind,
          path: repository.path,
          'base-ref': repository.baseRef,
          owner: repository.owner,
          repo: repository.repo,
          number: repository.number,
        };
  return [
    `<change${attributes({ scope: change.scope, 'base-sha': change.baseSha, 'head-sha': change.headSha, 'from-head-sha': change.fromHeadSha })}>`,
    `${indent}<repository${attributes(repositoryAttributes)}/>`,
    '</change>',
  ];
}

function itemElement(item: AgentReviewItem): string[] {
  const { origin } = item;
  const children = [
    ...(item.anchor === undefined ? [] : [anchorElement('anchor', item.anchor)]),
    ...(item.outdated === undefined
      ? []
      : [
          `<outdated${attributes({ reason: item.outdated.reason, 'written-against-sha': item.outdated.writtenAgainstSha })}>`,
          indent + anchorElement('original-anchor', item.outdated.originalAnchor),
          '</outdated>',
        ]),
    `<title>${escapeText(item.title)}</title>`,
    item.body === '' ? '<body/>' : `<body>${cdata(item.body)}</body>`,
    ...(origin.kind === 'impact-finding'
      ? [
          `<impact${attributes({ metric: origin.metric, function: origin.functionName, value: origin.value, threshold: origin.threshold, percentile: origin.percentile })}/>`,
        ]
      : []),
    ...(item.suggestedPatch === undefined
      ? []
      : [`<suggested-patch format="unified-diff">${cdata(item.suggestedPatch)}</suggested-patch>`]),
  ];
  const provenance =
    origin.kind === 'agent-insight'
      ? { 'insight-id': origin.insightId }
      : origin.kind === 'chat-answer'
        ? { 'message-id': origin.messageId }
        : {};
  return [
    `<item${attributes({ id: item.id, severity: item.severity, origin: origin.kind, ...provenance })}>`,
    ...children.map((line) => indent + line),
    '</item>',
  ];
}

function anchorElement(name: string, anchor: AgentReviewAnchor): string {
  switch (anchor.kind) {
    case 'lines': {
      const { kind, path, startLine, endLine } = anchor;
      return `<${name}${attributes({ kind, path, 'start-line': startLine, 'end-line': endLine })}/>`;
    }
    case 'file': {
      return `<${name}${attributes({ kind: anchor.kind, path: anchor.path })}/>`;
    }
    case 'change': {
      return `<${name}${attributes({ kind: anchor.kind })}/>`;
    }
  }
}

/** ` name="value"` pairs in the given order; `undefined` values are left out. */
function attributes(values: Readonly<Record<string, string | number | undefined>>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
    .join('');
}

function escapeText(value: string): string {
  return sanitize(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value)
    .replaceAll('"', '&quot;')
    .replaceAll('\t', '&#9;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;');
}

function cdata(value: string): string {
  return `<![CDATA[${sanitize(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

/**
 * Replaces what XML 1.0 can't carry even escaped (C0 controls other than tab, LF and CR, lone
 * surrogates, U+FFFE and U+FFFF) with U+FFFD.
 */
function sanitize(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const isAllowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7_ff) ||
      (code >= 0xe0_00 && code <= 0xff_fd) ||
      code >= 0x1_00_00;
    result += isAllowed ? character : '\u{FFFD}';
  }
  return result;
}
