import { formatDuration } from '#x/time/format-duration.ts';

/**
 * `712ms`, `2s 450ms`, `1m 30s` (`Intl.DurationFormat`, in the user's language); empty when
 * unknown. Takes the ISO-8601 duration string the contract carries (`PT0.712S`).
 */
export function formatIsoDuration(
  isoDuration: string | undefined,
  locale?: Intl.LocalesArgument,
): string {
  return isoDuration === undefined
    ? ''
    : formatDuration(Temporal.Duration.from(isoDuration), locale);
}
