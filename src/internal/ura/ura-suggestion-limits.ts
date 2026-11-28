/** How much one item may suggest (ADR 0162): at most 500 suggestions, each replacing with at most 64 KiB of UTF-8. */
export const uraSuggestionLimits = Object.freeze({
  maxSuggestions: 500,
  maxReplacementBytes: 64 * 1024,
});
