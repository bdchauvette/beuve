/**
 * `duration` as short text for a person: `1s 234ms`, `2m`, `1h 5m`, `0ms`. It uses
 * `Intl.DurationFormat` in the `narrow` style, after rounding to whole milliseconds and
 * balancing up to hours (`90s` reads `1m 30s`). The duration must have no years, months, weeks or
 * days.
 *
 * `locale` defaults to the runtime's own: the user's language in the renderer, the application
 * locale in the main process. Pass it only to pin the text (tests). `style` is the
 * `Intl.DurationFormat` style; `long` reads `1 minute, 30 seconds`.
 */
export function formatDuration(
  duration: Temporal.Duration,
  locale?: Intl.LocalesArgument,
  style: DurationStyle = 'narrow',
): string {
  const rounded = duration.round({
    largestUnit: 'hour',
    smallestUnit: 'millisecond',
    roundingMode: 'halfExpand',
  });
  if (rounded.sign === 0) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'millisecond',
      unitDisplay: unitDisplays[style],
    }).format(0);
  }
  return new Intl.DurationFormat(locale, { style }).format(rounded);
}

/** The styles `Intl.DurationFormat` offers. */
export type DurationStyle = 'long' | 'short' | 'narrow' | 'digital';

const unitDisplays: Readonly<Record<DurationStyle, 'long' | 'short' | 'narrow'>> = {
  long: 'long',
  short: 'short',
  narrow: 'narrow',
  digital: 'narrow',
};
