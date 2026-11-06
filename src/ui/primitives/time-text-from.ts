/** How `beuve-time` shows an instant: as a date and time, or relative to now. */
export type TimeFormat = 'absolute' | 'relative';

/** What `beuve-time` was asked to show, from its attributes. */
export interface TimeRequest {
  /** An ISO 8601 instant, such as `2026-11-06T13:05:00Z`. */
  readonly datetime: string;
  readonly now: Temporal.Instant;
  readonly format: TimeFormat;
  /** `Intl.DateTimeFormat` options for `absolute`, and for `relative` past `relativeUntil`. */
  readonly dateTime: Intl.DateTimeFormatOptions;
  /** `Intl.RelativeTimeFormat` options for `relative`. */
  readonly relative: Intl.RelativeTimeFormatOptions;
  /** How long a time reads as relative before it reads as a date. */
  readonly relativeUntil: Temporal.Duration;
  /** Defaults to the runtime's own; pass it, and `timeZone` in `dateTime`, only to pin the text. */
  readonly locale?: Intl.LocalesArgument;
}

/** The text, the full time for its title, and when the text goes stale (relative times only). */
export interface TimeText {
  readonly text: string;
  readonly title: string;
  readonly refreshIn?: Temporal.Duration;
}

/**
 * The text `beuve-time` shows (ADR 0115). `absolute` formats with the given
 * `Intl.DateTimeFormat` options (a medium date and short time when there are none). `relative`
 * reads "now" under a minute, then minutes, hours and days with `Intl.RelativeTimeFormat` ("5
 * minutes ago", "in 3 hours", "yesterday"), and a short date ("Nov 6", with the year when it is not
 * this year's) from `relativeUntil` on. `undefined` when `datetime` is not an instant. Pure.
 */
export function timeTextFrom(request: TimeRequest): TimeText | undefined {
  const instant = instantFrom(request.datetime);
  if (instant === undefined) {
    return undefined;
  }
  const timeZone = request.dateTime.timeZone;
  const title = instant.toLocaleString(request.locale, {
    dateStyle: 'full',
    timeStyle: 'long',
    ...(timeZone !== undefined && { timeZone }),
  });
  if (request.format === 'absolute') {
    return { text: absoluteText(instant, request), title };
  }
  return { ...relativeText(instant, request), title };
}

function instantFrom(datetime: string): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(datetime);
  } catch {
    return undefined;
  }
}

function absoluteText(instant: Temporal.Instant, request: TimeRequest): string {
  let options = request.dateTime;
  if (!hasFields(options)) {
    options = { ...options, dateStyle: 'medium', timeStyle: 'short' };
  }
  return instant.toLocaleString(request.locale, options);
}

/** Whether the options name anything to show, beyond a time zone or calendar. */
function hasFields(options: Intl.DateTimeFormatOptions): boolean {
  return shownFields.some((field) => options[field] !== undefined);
}

const shownFields: readonly (keyof Intl.DateTimeFormatOptions)[] = [
  'dateStyle',
  'timeStyle',
  'weekday',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'timeZoneName',
];

/** A relative time, and how soon it changes. */
interface RelativeText {
  readonly text: string;
  readonly refreshIn?: Temporal.Duration;
}

function relativeText(instant: Temporal.Instant, request: TimeRequest): RelativeText {
  const isPast = Temporal.Instant.compare(instant, request.now) <= 0;
  let elapsed = request.now.until(instant).abs();
  if (isPast) {
    elapsed = instant.until(request.now);
  }
  const isUnder = (limit: Temporal.DurationLike): boolean => {
    return Temporal.Duration.compare(elapsed, limit) < 0;
  };
  if (Temporal.Duration.compare(elapsed, request.relativeUntil) >= 0) {
    return { text: shortDateText(instant, request) };
  }
  const format = new Intl.RelativeTimeFormat(request.locale, request.relative);
  const say = (unit: 'minute' | 'hour' | 'day'): string => {
    let whole = elapsed.round({ largestUnit: unit, smallestUnit: unit, roundingMode: 'trunc' });
    if (isPast) {
      whole = whole.negated();
    }
    return format.format(wholeUnits[unit](whole), unit);
  };
  if (isUnder({ minutes: 1 })) {
    return { text: format.format(0, 'second'), refreshIn: Temporal.Duration.from({ seconds: 30 }) };
  }
  if (isUnder({ hours: 1 })) {
    return { text: say('minute'), refreshIn: Temporal.Duration.from({ seconds: 30 }) };
  }
  if (isUnder({ hours: 24 })) {
    return { text: say('hour'), refreshIn: Temporal.Duration.from({ minutes: 5 }) };
  }
  return { text: say('day'), refreshIn: Temporal.Duration.from({ hours: 1 }) };
}

/** The whole count of each unit in a duration rounded to that unit. */
const wholeUnits: Readonly<
  Record<'minute' | 'hour' | 'day', (duration: Temporal.Duration) => number>
> = {
  minute: (duration) => {
    return duration.minutes;
  },
  hour: (duration) => {
    return duration.hours;
  },
  day: (duration) => {
    return duration.days;
  },
};

function shortDateText(instant: Temporal.Instant, request: TimeRequest): string {
  const timeZone = request.dateTime.timeZone ?? Temporal.Now.timeZoneId();
  const isThisYear =
    instant.toZonedDateTimeISO(timeZone).year === request.now.toZonedDateTimeISO(timeZone).year;
  return instant.toLocaleString(request.locale, {
    month: 'short',
    day: 'numeric',
    timeZone,
    ...(!isThisYear && { year: 'numeric' }),
  });
}
