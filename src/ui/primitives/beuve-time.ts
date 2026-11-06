import { css, html, LitElement, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { timeTextFrom } from './time-text-from.ts';
import type { TimeFormat } from './time-text-from.ts';

type DateTimeOptions = Intl.DateTimeFormatOptions;

/**
 * An instant as a `<time datetime>` (ADR 0115), formatted with `Intl` in the user's language. Its
 * `Intl.DateTimeFormat` options are attributes: `date-style`, `time-style`, `year`, `month`,
 * `day`, `weekday`, `hour`, `minute`, `second`, `time-zone-name` (a medium date and short time
 * when none is set). `format="relative"` reads "5 minutes ago" with `Intl.RelativeTimeFormat`
 * (`numeric`, `format-style`), refreshes itself while connected, and becomes a short date after
 * `relative-until` (an ISO duration, seven days unless set). The full date and time is the title,
 * unless the element has a `title` of its own. Nothing renders for text that is not an instant.
 */
@customElement('beuve-time')
export class BeuveTime extends LitElement {
  static override styles = css`
    :host {
      display: inline;
    }
  `;

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** An ISO 8601 instant, such as `2026-11-06T13:05:00Z`. */
  @property() accessor datetime = '';
  @property() accessor format: TimeFormat = 'absolute';
  @property({ attribute: 'date-style' }) accessor dateStyle: DateTimeOptions['dateStyle'];
  @property({ attribute: 'time-style' }) accessor timeStyle: DateTimeOptions['timeStyle'];
  @property() accessor year: DateTimeOptions['year'];
  @property() accessor month: DateTimeOptions['month'];
  @property() accessor day: DateTimeOptions['day'];
  @property() accessor weekday: DateTimeOptions['weekday'];
  @property() accessor hour: DateTimeOptions['hour'];
  @property() accessor minute: DateTimeOptions['minute'];
  @property() accessor second: DateTimeOptions['second'];
  @property({ attribute: 'time-zone-name' }) accessor timeZoneName: DateTimeOptions['timeZoneName'];
  @property() accessor numeric: Intl.RelativeTimeFormatNumeric = 'auto';
  @property({ attribute: 'format-style' })
  accessor formatStyle: Intl.RelativeTimeFormatStyle = 'long';
  @property({ attribute: 'relative-until' }) accessor relativeUntil = 'P7D';

  private dateTimeOptions(): DateTimeOptions {
    const options: DateTimeOptions = {
      dateStyle: this.dateStyle,
      timeStyle: this.timeStyle,
      year: this.year,
      month: this.month,
      day: this.day,
      weekday: this.weekday,
      hour: this.hour,
      minute: this.minute,
      second: this.second,
      timeZoneName: this.timeZoneName,
    };
    return Object.fromEntries(
      Object.entries(options).filter(([, value]) => {
        return value !== undefined;
      }),
    );
  }

  private relativeUntilDuration(): Temporal.Duration {
    try {
      return Temporal.Duration.from(this.relativeUntil);
    } catch {
      return Temporal.Duration.from({ days: 7 });
    }
  }

  override disconnectedCallback(): void {
    clearTimeout(this.refreshTimer);
    // eslint-disable-next-line wc/guard-super-call -- LitElement implements it.
    super.disconnectedCallback();
  }

  protected override render(): TemplateResult | typeof nothing {
    clearTimeout(this.refreshTimer);
    let shown: ReturnType<typeof timeTextFrom>;
    try {
      shown = timeTextFrom({
        datetime: this.datetime,
        now: Temporal.Now.instant(),
        format: this.format,
        dateTime: this.dateTimeOptions(),
        relative: { numeric: this.numeric, style: this.formatStyle },
        relativeUntil: this.relativeUntilDuration(),
      });
    } catch {
      // Options Intl refuses (a misspelt style) show the instant as written.
      return html`<time datetime=${this.datetime}>${this.datetime}</time>`;
    }
    if (shown === undefined) {
      return nothing;
    }
    if (shown.refreshIn !== undefined) {
      this.refreshTimer = setTimeout(() => {
        this.requestUpdate();
      }, shown.refreshIn.total('millisecond'));
    }
    return html`<time
      datetime=${this.datetime}
      title=${this.hasAttribute('title') ? nothing : shown.title}
      >${shown.text}</time
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'beuve-time': BeuveTime;
  }
}
