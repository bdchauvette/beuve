import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { defaultReviewQueuePrefs } from '#contract/default-review-queue-prefs.ts';
import type {
  LocalReviewStateView,
  QueueCiFilterView,
  QueueFiltersView,
  QueueGroupView,
  QueueItemKindView,
  QueueSortView,
  QueueWaitingSourceView,
  ReviewQueueItemView,
  ReviewQueuePrefsView,
  ReviewQueueView,
  TurnView,
} from '#contract/ipc-contract.ts';

import { ActionDelegation } from './action-delegation.ts';
import { describeAttention } from './describe-attention.ts';
import { describeLocalReview } from './describe-local-review.ts';
import { describeQueueCi } from './describe-queue-ci.ts';
import { displayIcon } from './display-icon.ts';
import { filterQueueItems } from './filter-queue-items.ts';
import { formatControlStyles } from './format-control-styles.ts';
import { groupQueueItems } from './group-queue-items.ts';
import { pathText } from './path-text.ts';
import { queueIcon } from './queue-icon.ts';
import { sortQueueItems } from './sort-queue-items.ts';
import { withStackContext } from './with-stack-context.ts';
import { buttonStyles } from './primitives/button-styles.ts';
import { statusDotStyles } from './primitives/status-dot-styles.ts';
import { badgeStyles } from './primitives/badge-styles.ts';
import { emptyStateStyles } from './primitives/empty-state-styles.ts';
import { menuItemStyles } from './primitives/menu-item-styles.ts';
import './primitives/beuve-time.ts';
import './primitives/beuve-menu.ts';

/** Open a queue item: `ref` is its key, which `GithubController.open` takes. */
export interface QueueOpenDetail {
  readonly ref: string;
}

/** Open a link from a queue row (the agent session) in the browser. */
export interface QueueOpenUrlDetail {
  readonly url: string;
}

/**
 * The review queue (ADR 0113): everything waiting on the signed-in GitHub user, sorted, grouped
 * and filtered as the preferences say, with what may be missing from it. A presentational
 * component (ADR 0104): it takes the snapshot and the preferences, and reports intent with
 * `beuve-queue-open`, `beuve-queue-prefs` (the whole new preferences), `beuve-queue-refresh` and
 * `beuve-queue-open-url`. The free text and the cursor are its own. ↑/↓ move, ↩ opens. Grouped
 * by stack, every stack with a matching member shows whole: members not waiting on the viewer or
 * hidden by the filters are dimmed, openable, and not counted (ADR 0113 amendment).
 */
@customElement('beuve-review-queue')
export class BeuveReviewQueue extends LitElement {
  static override styles = [
    menuItemStyles,
    emptyStateStyles,
    badgeStyles,
    statusDotStyles,
    buttonStyles,
    formatControlStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        min-block-size: 0;
        gap: var(--beuve-space-2);
        font: var(--beuve-font-body);
        color: var(--beuve-text);
      }

      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--beuve-space-2);
      }

      h2 {
        margin-block: 0;
        margin-inline: 0 auto;
        font-size: var(--beuve-font-size-title);
        font-weight: var(--beuve-font-weight-semibold);
      }

      h2 .count {
        margin-inline-start: var(--beuve-space-2);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-normal);
        color: var(--beuve-text-muted);
      }

      .updated {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
        white-space: nowrap;
      }

      .control {
        position: relative;
        display: inline-flex;
      }

      header button[aria-busy='true'] svg {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          rotate: 1turn;
        }
      }

      input[type='search'] {
        inline-size: calc(14 * var(--beuve-measure-em));
        padding: var(--beuve-space-0-5) var(--beuve-space-2);
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius-small);
        background: var(--beuve-bg);
        color: var(--beuve-text);
        font: var(--beuve-font-small);
      }

      .problems {
        display: flex;
        flex-direction: column;
        gap: var(--beuve-space-0-5);
        margin: 0;
        padding: 0;
        list-style: none;
        font: var(--beuve-font-small);
        color: var(--beuve-warn);
      }

      .problems li {
        display: flex;
        align-items: baseline;
        gap: var(--beuve-space-1);
      }

      .problems code {
        font-family: var(--beuve-font-mono);
        color: var(--beuve-text-muted);
      }

      .list {
        flex: 1;
        min-block-size: 0;
        overflow: auto;
        border: var(--beuve-border-width) solid var(--beuve-border);
        border-radius: var(--beuve-radius);
        background: var(--beuve-surface);
        outline: none;
      }

      .list:focus-visible {
        border-color: var(--beuve-accent);
      }

      .heading {
        position: sticky;
        inset-block-start: 0;
        z-index: 1;
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        background: var(--beuve-surface-sunken);
        font: var(--beuve-font-small);
        font-weight: var(--beuve-font-weight-semibold);
        color: var(--beuve-text-muted);
      }

      .row {
        display: grid;
        grid-template-columns:
          var(--beuve-size-icon) minmax(
            calc(8 * var(--beuve-measure-em)),
            calc(13 * var(--beuve-measure-em))
          )
          minmax(0, 1fr) minmax(
            calc(4 * var(--beuve-measure-em)),
            calc(7 * var(--beuve-measure-em))
          )
          calc(7.5 * var(--beuve-measure-em)) var(--beuve-size-dot) calc(
            6.5 * var(--beuve-measure-em)
          )
          calc(6.5 * var(--beuve-measure-em)) calc(4.5 * var(--beuve-measure-em));
        align-items: center;
        gap: var(--beuve-space-2);
        padding: var(--beuve-space-1) var(--beuve-space-3);
        border-block-end: var(--beuve-border-width) solid var(--beuve-border);
        cursor: default;
      }

      .row:last-child {
        border-block-end: 0;
      }

      .row:hover {
        background: var(--beuve-bg);
      }

      .row[aria-selected='true'] {
        background: var(--beuve-accent-soft);
      }

      .row.stale {
        opacity: 0.7;
      }

      .row.context {
        opacity: 0.55;
      }

      .row > span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .kind {
        display: inline-flex;
        color: var(--beuve-text-muted);
      }

      .where {
        font: var(--beuve-font-small);
        color: var(--beuve-text-muted);
      }

      .where .ref {
        color: var(--beuve-text);
      }

      .title .stacked {
        color: var(--beuve-text-muted);
      }

      .title .badge {
        margin-inline-start: var(--beuve-space-1);
      }

      .author,
      .size,
      .age {
        font: var(--beuve-font-small);
        font-variant-numeric: tabular-nums;
        color: var(--beuve-text-muted);
      }

      .size .added {
        color: var(--beuve-diff-added-text);
      }

      .size .removed {
        color: var(--beuve-diff-removed-text);
      }

      .age {
        text-align: end;
      }

      .ok {
        color: var(--beuve-ok);
      }

      .warn {
        color: var(--beuve-warn);
      }

      .danger {
        color: var(--beuve-danger);
      }

      .accent {
        color: var(--beuve-accent);
      }

      .muted {
        color: var(--beuve-text-muted);
      }

      .turn,
      .local {
        font: var(--beuve-font-small);
      }

      .turn.yours {
        color: var(--beuve-accent);
        font-weight: var(--beuve-font-weight-semibold);
      }

      .empty {
        padding: var(--beuve-space-4);
        text-align: center;
      }
    `,
  ];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const rows = this.visibleItems();
    if (rows.length === 0) {
      return;
    }
    const index = Math.max(
      0,
      rows.findIndex((item) => item.key === this.cursorKey),
    );
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: Math.min(rows.length - 1, index + 1),
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: rows.length - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      this.cursorKey = rows[next]?.key;
      void this.updateComplete.then(() => {
        this.renderRoot.querySelector('.row[aria-selected="true"]')?.scrollIntoView({
          block: 'nearest',
        });
      });
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const key = rows[index]?.key;
    if (key !== undefined) {
      this.open(key);
    }
  };

  private readonly onText = (event: InputEvent): void => {
    this.text = (event.currentTarget as HTMLInputElement).value;
  };

  /** The queue as main last sent it; `undefined` before the first answer. */
  @property({ attribute: false }) accessor queue: ReviewQueueView | undefined;
  /** Why the queue could not be read, or `''`. */
  @property() accessor error = '';
  @property({ attribute: false }) accessor prefs: ReviewQueuePrefsView = defaultReviewQueuePrefs;

  @state() accessor text = '';
  @state() accessor cursorKey: string | undefined;

  constructor() {
    super();
    this.addController(
      new ActionDelegation(this, {
        click: {
          open: ({ key }): void => {
            if (key === undefined) {
              return;
            }
            this.cursorKey = key;
            this.open(key);
          },
          'open-url': ({ url }, event): void => {
            event.stopPropagation();
            if (url !== undefined) {
              this.emit('beuve-queue-open-url', { url });
            }
          },
          refresh: (): void => {
            this.emit('beuve-queue-refresh', {});
          },
          sort: ({ value }): void => {
            const sort = sortLabels.find(([id]) => id === value)?.[0];
            if (sort !== undefined) {
              this.change({ ...this.prefs, sort });
            }
          },
          group: ({ value }): void => {
            const group = groupLabels.find(([id]) => id === value)?.[0];
            if (group !== undefined) {
              this.change({ ...this.prefs, group });
            }
          },
          filter: ({ facet, value }): void => {
            if (facet !== undefined && value !== undefined) {
              this.toggleFilter({ facet, value });
            }
          },
          'clear-filters': (): void => {
            this.text = '';
            this.change({ ...this.prefs, filters: defaultReviewQueuePrefs.filters });
          },
        },
      }),
    );
  }

  private open(ref: string): void {
    this.emit('beuve-queue-open', { ref });
  }

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private change(prefs: ReviewQueuePrefsView): void {
    this.emit('beuve-queue-prefs', prefs);
  }

  private toggleFilter(toggle: FilterToggle): void {
    const next = filtersToggled(this.prefs.filters, toggle);
    if (next === undefined) {
      return;
    }
    this.change({ ...this.prefs, filters: next });
  }

  /** The rows in the order they show, groups flattened. */
  private visibleItems(): ReviewQueueItemView[] {
    return this.layout().groups.flatMap((group) => group.items);
  }

  /**
   * The queued items, those the filters let through, and the groups to show: with the rest of
   * their stacks when grouping by stack.
   */
  private layout(): QueueLayout {
    const all = this.queue?.items ?? [];
    const queued = all.filter((item) => item.isContext !== true);
    const matched = filterQueueItems(queued, { filters: this.prefs.filters, text: this.text });
    let shown = matched;
    if (this.prefs.group === 'stack') {
      shown = withStackContext({ all, matched });
    }
    const groups = groupQueueItems(sortQueueItems(shown, this.prefs.sort), this.prefs.group);
    return { queued, matched: new Set(matched), groups };
  }

  private renderBody({ all, groups, matched, cursor }: BodyParts): TemplateResult {
    if (this.queue === undefined) {
      return html`<div class="empty">
        ${this.error === '' ? 'Reading the queue…' : this.error}
      </div>`;
    }
    if (all.length === 0) {
      return html`<div class="empty">
        ${this.queue.isRefreshing ? 'Asking GitHub…' : 'Nothing is waiting on you.'}
      </div>`;
    }
    const rows = groups.flatMap((group) => group.items);
    if (rows.length === 0) {
      return html`<div class="empty">
        All ${String(all.length)} are hidden by the filters.
        <button class="button" type="button" data-action="clear-filters">Clear filters</button>
      </div>`;
    }
    let index = 0;
    return html`${groups.map((group) => {
      return html`${group.label === '' ? nothing : html`<div class="heading" role="presentation">${group.label}</div>`}
      ${group.items.map((item) => {
        const row = this.renderRow({
          item,
          index,
          isCursor: item === cursor,
          isMatched: matched.has(item),
        });
        index += 1;
        return row;
      })}`;
    })}`;
  }

  private renderRow({ item, index, isCursor, isMatched }: RowParts): TemplateResult {
    const ci = describeQueueCi(item.ci);
    const turn = describeAttention(item.attention);
    const aside = asideOf(item, isMatched);
    const local = describeLocalReview(item.local);
    const repository = `${item.owner}/${item.repo}`;
    const depth = item.stack?.depth ?? 0;
    return html`<div
      id="row-${String(index)}"
      class="row ${item.isStale === true ? 'stale' : ''} ${aside === undefined ? '' : 'context'}"
      role="option"
      aria-selected=${isCursor ? 'true' : 'false'}
      data-action="open"
      data-key=${item.key}
      title=${item.isStale === true ? 'Its source failed in the last refresh: this is the last answer it gave' : nothing}
    >
      <span
        class="kind"
        title=${item.kind === 'branch' ? 'Branch without a pull request' : 'Pull request'}
        >${queueIcon(item.kind)}</span
      >
      <span class="where" title=${`${item.host}/${repository}`}
        >${pathText(repository)}
        <span class="ref" title=${item.branch ?? ''}
          >${item.number === undefined ? pathText(item.branch ?? '') : `#${String(item.number)}`}</span
        ></span
      >
      <span class="title" title=${item.title}
        >${depth > 0 ? html`<span class="stacked">${'↳ '.repeat(depth)}</span>` : nothing}${item.title}${
          item.isDraft ? html`<span class="badge">Draft</span>` : nothing
        }${
          aside === undefined
            ? nothing
            : html`<span class="badge" title=${aside.title}>${aside.text}</span>`
        }${
          item.request === 'team'
            ? html`<span class="badge" title="Requested of a team you are on">Team</span>`
            : nothing
        }${
          item.agentSessionUrl === undefined
            ? nothing
            : html`<button
                type="button"
                class="badge"
                data-action="open-url"
                data-url=${item.agentSessionUrl}
                title=${`Agent session: ${item.agentSessionUrl}`}
              >
                Agent
              </button>`
        }</span
      >
      <span class="author" title=${item.author}>${item.author}</span>
      <span
        class="size"
        title=${item.size === undefined ? 'Size not read yet' : `${String(item.size.changedFiles)} files changed`}
        >${
          item.size === undefined
            ? ''
            : html`<span class="added">+${item.size.additions}</span>
                <span class="removed">−${item.size.deletions}</span> · ${item.size.changedFiles}f`
        }</span
      >
      <span class="status-dot" data-tone=${ci.tone} title=${ci.title}></span>
      <span
        class="turn ${turn?.isYours === true ? 'yours' : 'muted'}"
        title=${turn?.title ?? item.attention.reasons.join('\n')}
        >${turn?.text ?? ''}</span
      >
      <span class="local ${local.tone}" title=${local.title}>${local.text}</span>
      <beuve-time
        class="age"
        datetime=${item.waitingSince}
        format="relative"
        title=${`${waitingLabels[item.waitingSinceSource]} ${item.waitingSince}; opened ${item.createdAt}`}
      ></beuve-time>
    </div>`;
  }

  private renderProblems(): TemplateResult | typeof nothing {
    const problems = this.queue?.problems ?? [];
    if (problems.length === 0 && this.error === '') {
      return nothing;
    }
    return html`<ul class="problems" role="status">
      ${this.error === '' ? nothing : html`<li>${queueIcon('warning')}${this.error}</li>`}
      ${problems.map((problem) => {
        return html`<li title=${problem.source}>
          ${queueIcon('warning')}<span
            >${problem.message}${problem.remedy === undefined ? nothing : html` Run <code>${problem.remedy}</code>.`}</span
          >
        </li>`;
      })}
    </ul>`;
  }

  private renderSortMenu(): TemplateResult {
    const current = sortLabels.find(([id]) => id === this.prefs.sort)?.[1] ?? '';
    return html`<beuve-menu class="control" label="Sort">
      <button
        slot="trigger"
        class="button"
        type="button"
        aria-label="Sort: ${current}"
        title="Sort the queue"
      >
        ${displayIcon('sort')}<span>${current}</span>${displayIcon('chevron')}
      </button>
      ${sortLabels.map(([id, label]) => {
        return html`<button
          type="button"
          role="menuitemradio"
          aria-checked=${id === this.prefs.sort ? 'true' : 'false'}
          data-action="sort"
          data-value=${id}
        >
          ${displayIcon('check')}${label}
        </button>`;
      })}
    </beuve-menu>`;
  }

  private renderGroupMenu(): TemplateResult {
    const current = groupLabels.find(([id]) => id === this.prefs.group)?.[1] ?? '';
    return html`<beuve-menu class="control" label="Group by">
      <button
        slot="trigger"
        class="button"
        type="button"
        aria-label="Group: ${current}"
        title="Group the queue"
      >
        ${queueIcon('group')}<span>${current}</span>${displayIcon('chevron')}
      </button>
      ${groupLabels.map(([id, label]) => {
        return html`<button
          type="button"
          role="menuitemradio"
          aria-checked=${id === this.prefs.group ? 'true' : 'false'}
          data-action="group"
          data-value=${id}
        >
          ${displayIcon('check')}${label}
        </button>`;
      })}
    </beuve-menu>`;
  }

  private renderFilterMenu(all: readonly ReviewQueueItemView[]): TemplateResult {
    const { filters } = this.prefs;
    const active = activeFilterCount(filters);
    const repositories = [
      ...new Set(all.map((item) => `${item.host}/${item.owner}/${item.repo}`.toLowerCase())),
    ].toSorted((left, right) => left.localeCompare(right));
    const authors = [...new Set(all.map((item) => item.author))].toSorted((left, right) => {
      return left.localeCompare(right);
    });
    const option = ({ facet, value, label, isOn }: FilterOption): TemplateResult => {
      return html`<button
        type="button"
        role="menuitemcheckbox"
        aria-checked=${isOn ? 'true' : 'false'}
        data-action="filter"
        data-facet=${facet}
        data-value=${value}
      >
        ${displayIcon('check')}${label}
      </button>`;
    };
    const section = (title: string, options: readonly FilterOption[]): TemplateResult => {
      return html`<h3 class="menu-heading">${title}</h3>
        ${options.map((entry) => option(entry))}`;
    };
    return html`<beuve-menu class="control" label="Filters">
      <button
        slot="trigger"
        class="button"
        type="button"
        aria-label="Filters${active === 0 ? '' : ` (${String(active)} on)`}"
        title="Filter the queue"
      >
        ${queueIcon('filter')}<span>Filter</span>${
          active === 0 ? nothing : html`<span class="badge count">${active}</span>`
        }
      </button>
      ${section('Show', [
        {
          facet: 'flag',
          value: 'waiting',
          label: 'Your pull requests waiting on others',
          isOn: filters.showWaitingOnOthers,
        },
        { facet: 'flag', value: 'drafts', label: 'Hide drafts', isOn: filters.hideDrafts },
      ])}
      ${section(
        'Kind',
        kindLabels.map(([value, label]) => {
          return { facet: 'kind', value, label, isOn: filters.kinds.includes(value) };
        }),
      )}
      ${section(
        'Requested',
        requestLabels.map(([value, label]) => {
          return { facet: 'request', value, label, isOn: filters.request === value };
        }),
      )}
      ${section(
        'Turn',
        turnLabels.map(([value, label]) => {
          return { facet: 'turn', value, label, isOn: filters.turns.includes(value) };
        }),
      )}
      ${section(
        'Your review',
        localLabels.map(([value, label]) => {
          return { facet: 'local', value, label, isOn: filters.local.includes(value) };
        }),
      )}
      ${section(
        'CI',
        ciLabels.map(([value, label]) => {
          return { facet: 'ci', value, label, isOn: filters.ci.includes(value) };
        }),
      )}
      ${section(
        'Repository',
        repositories.map((value) => {
          return {
            facet: 'repository',
            value,
            label: value.replace(githubPrefix, ''),
            isOn: filters.repositories.includes(value),
          };
        }),
      )}
      ${section(
        'Author',
        authors.map((value) => {
          return { facet: 'author', value, label: value, isOn: filters.authors.includes(value) };
        }),
      )}
      <h3></h3>
      <button type="button" role="menuitem" data-action="clear-filters">Clear filters</button>
    </beuve-menu>`;
  }

  /** Puts the keyboard on the list. */
  focusList(): void {
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('.list')?.focus();
    });
  }

  protected override render(): TemplateResult {
    const { queued: all, matched, groups } = this.layout();
    const rows = groups.flatMap((group) => group.items);
    const cursor = rows.find((item) => item.key === this.cursorKey) ?? rows[0];
    return html`
      <header>
        <h2>
          Review Queue<span class="count"
            >${
              matched.size === all.length
                ? String(all.length)
                : `${String(matched.size)} of ${String(all.length)}`
            }</span
          >
        </h2>
        <input
          type="search"
          placeholder="Filter by text"
          aria-label="Filter by text"
          spellcheck="false"
          .value=${this.text}
          @input=${this.onText}
        />
        ${this.renderFilterMenu(all)} ${this.renderGroupMenu()} ${this.renderSortMenu()}
        <span class="updated" title=${this.queue?.refreshedAt ?? ''}
          >${describeUpdated(this.queue)}</span
        >
        <button
          class="button"
          type="button"
          data-action="refresh"
          aria-label="Refresh"
          title="Refresh now"
          aria-busy=${this.queue?.isRefreshing === true ? 'true' : 'false'}
        >
          ${queueIcon('refresh')}
        </button>
      </header>
      ${this.renderProblems()}
      <div
        class="list"
        role="listbox"
        tabindex="0"
        aria-label="Review queue"
        aria-activedescendant=${cursor === undefined ? nothing : `row-${String(rows.indexOf(cursor))}`}
        @keydown=${this.onKeyDown}
      >
        ${this.renderBody({ all, groups, matched, cursor })}
      </div>
    `;
  }
}

/** The queue as it shows: what is queued, what the filters let through, and the groups. */
interface QueueLayout {
  /** Every item waiting on the viewer: the count's total, and what filters choose from. */
  readonly queued: readonly ReviewQueueItemView[];
  readonly matched: ReadonlySet<ReviewQueueItemView>;
  readonly groups: ReturnType<typeof groupQueueItems>;
}

/** What the list body renders from. */
interface BodyParts {
  readonly all: readonly ReviewQueueItemView[];
  readonly groups: ReturnType<typeof groupQueueItems>;
  readonly matched: ReadonlySet<ReviewQueueItemView>;
  readonly cursor: ReviewQueueItemView | undefined;
}

/** One row and where it is. */
interface RowParts {
  readonly item: ReviewQueueItemView;
  readonly index: number;
  readonly isCursor: boolean;
  /** It passed the filters; a stack member that did not shows dimmed. */
  readonly isMatched: boolean;
}

/** Why a row shows dimmed beside its stack. */
interface RowAside {
  readonly text: string;
  readonly title: string;
}

/** One checkable filter in the menu. */
interface FilterOption {
  readonly facet: string;
  readonly value: string;
  readonly label: string;
  readonly isOn: boolean;
}

/** Which filter value a menu item toggles. */
interface FilterToggle {
  readonly facet: string;
  readonly value: string;
}

const githubPrefix = /^github\.com\//u;

/** What the age column's time is, for its tooltip. */
const waitingLabels: Readonly<Record<QueueWaitingSourceView, string>> = {
  requested: 'Your review was asked',
  'changes-requested': 'Changes were requested',
  pushed: 'Last commit',
  updated: 'Last activity',
};

const sortLabels: readonly (readonly [QueueSortView, string])[] = [
  ['turn', 'Your turn first'],
  ['waiting', 'Waiting longest'],
  ['oldest', 'Oldest'],
  ['updated', 'Recently updated'],
  ['smallest', 'Smallest'],
  ['largest', 'Largest'],
  ['stack', 'Stack order'],
  ['new-since-review', 'New since your review'],
];

const groupLabels: readonly (readonly [QueueGroupView, string])[] = [
  ['none', 'No grouping'],
  ['repository', 'Repository'],
  ['stack', 'Stack'],
  ['turn', 'Turn'],
  ['kind', 'Kind'],
  ['local', 'Your review'],
];

const kindLabels: readonly (readonly [QueueItemKindView, string])[] = [
  ['pull-request', 'Pull requests'],
  ['branch', 'Branches without a pull request'],
];

const requestLabels: readonly (readonly [QueueFiltersView['request'], string])[] = [
  ['any', 'Any way'],
  ['direct', 'Of you by name'],
  ['team', 'Of your team'],
];

const turnLabels: readonly (readonly [TurnView, string])[] = [
  ['you', 'Yours'],
  ['reviewers', 'Reviewers’'],
  ['author', 'Author’s'],
  ['unknown', 'Nobody’s'],
];

const localLabels: readonly (readonly [LocalReviewStateView, string])[] = [
  ['none', 'Not opened'],
  ['opened', 'Opened'],
  ['partial', 'In progress'],
  ['new-commits', 'New commits since'],
  ['reviewed', 'Reviewed'],
];

const ciLabels: readonly (readonly [QueueCiFilterView, string])[] = [
  ['failure', 'Failing'],
  ['pending', 'Running'],
  ['success', 'Passing'],
];

/** A stack member that shows only beside its stack: not waiting on the viewer, or filtered out. */
function asideOf(item: ReviewQueueItemView, isMatched: boolean): RowAside | undefined {
  if (item.isContext === true) {
    return {
      text: 'Not waiting on you',
      title: 'In the stack of a pull request that is waiting on you',
    };
  }
  if (!isMatched) {
    return { text: 'Filtered out', title: 'Hidden by your filters; shown with its stack' };
  }
  return undefined;
}

/** "Updated 3 minutes ago", "Updating…" or nothing yet. */
function describeUpdated(queue: ReviewQueueView | undefined): TemplateResult | string {
  if (queue?.isRefreshing === true) {
    return 'Updating…';
  }
  if (queue?.refreshedAt === undefined) {
    return '';
  }
  return html`Updated <beuve-time datetime=${queue.refreshedAt} format="relative"></beuve-time>`;
}

/** How many filters differ from the defaults. */
function activeFilterCount(filters: QueueFiltersView): number {
  return [
    filters.kinds.length > 0,
    filters.repositories.length > 0,
    filters.authors.length > 0,
    filters.request !== 'any',
    filters.hideDrafts,
    filters.ci.length > 0,
    filters.turns.length > 0,
    filters.local.length > 0,
    filters.showWaitingOnOthers,
  ].filter(Boolean).length;
}

/** The filters with one menu item toggled; `undefined` for an item it does not know. */
function filtersToggled(
  filters: QueueFiltersView,
  { facet, value }: FilterToggle,
): QueueFiltersView | undefined {
  switch (facet) {
    case 'flag': {
      if (value === 'waiting') {
        return { ...filters, showWaitingOnOthers: !filters.showWaitingOnOthers };
      }
      return { ...filters, hideDrafts: !filters.hideDrafts };
    }
    case 'kind': {
      return { ...filters, kinds: toggled(filters.kinds, known(kindLabels, value)) };
    }
    case 'request': {
      return { ...filters, request: known(requestLabels, value) ?? 'any' };
    }
    case 'turn': {
      return { ...filters, turns: toggled(filters.turns, known(turnLabels, value)) };
    }
    case 'local': {
      return { ...filters, local: toggled(filters.local, known(localLabels, value)) };
    }
    case 'ci': {
      return { ...filters, ci: toggled(filters.ci, known(ciLabels, value)) };
    }
    case 'repository': {
      return { ...filters, repositories: toggled(filters.repositories, value) };
    }
    case 'author': {
      return { ...filters, authors: toggled(filters.authors, value) };
    }
    default: {
      return undefined;
    }
  }
}

/** The labelled id `value` names, if any. */
function known<T extends string>(
  labels: readonly (readonly [T, string])[],
  value: string,
): T | undefined {
  return labels.find(([id]) => id === value)?.[0];
}

/** The list with `value` added, or removed when it was there. */
function toggled<T>(list: readonly T[], value: T | undefined): readonly T[] {
  if (value === undefined) {
    return list;
  }
  if (list.includes(value)) {
    return list.filter((entry) => entry !== value);
  }
  return [...list, value];
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-review-queue': BeuveReviewQueue;
  }
}
