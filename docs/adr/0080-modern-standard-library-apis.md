# 0080. Modern standard-library APIs, each with its lint rule

- Status: Accepted
- Date: 2026-10-30

## Context

An audit ran each ES2025/ESNext API against the three runtimes and the type libraries, on the real binaries and not from memory. The runtime floor is set by what code can run in all of them:

- **Electron 45 main (Node 24.22.1 on Chromium 156's V8)** and **Chromium 156 (renderer)** have everything adopted below.
- **Node 26.13 (dev, tests, CI)** is the binding constraint: anything a test executes must exist there. It lacks `Iterator.zip` and `Math.sumPrecise`; Chromium 156 lacks `ReadableStream.from`.
- **TypeScript 6.0** declared none of the ES2025 libs in beuve's `lib` (`es2024` only), so the lint rules that ask for Set methods, iterator helpers or `Promise.try` asked for code that did not type-check.

Each API below removes a bug class, not just a few characters.

## Decision

The `lib` of both tsconfigs is `es2025` plus `esnext.array`, `esnext.collection`, `esnext.error` and `esnext.typedarrays` (and the existing `esnext.disposable`, `esnext.temporal`, `esnext.date`). Every adopted API ships with the rule that keeps the old pattern out.

| API                                                        | Replaces                                                                                                             | Enforced by                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `Error.isError(x)`                                         | `x instanceof Error`, false for errors from another realm (worker, `vm`, structured clone), which lost their message | `unicorn/prefer-error-is-error`            |
| `Map#getOrInsertComputed` (`getOrInsert` for cheap values) | `get(k) ?? new`, then `set(k, v)`                                                                                    | `e18e/prefer-get-or-insert`                |
| `URL.parse(text)`                                          | `try { new URL(text) } catch { fallback }`                                                                           | `local/prefer-url-parse`                   |
| `tailOf(text, n)` (`#x/text/tail-of.ts`)                   | `text.slice(-n)`, which can cut a surrogate pair                                                                     | `local/no-string-tail-slice` (type-aware)  |
| `RegExp.escape(text)`                                      | hand-written escaping                                                                                                | `unicorn/prefer-regexp-escape`             |
| `Uint8Array#toBase64`, `.fromBase64`, `.toHex`, `.fromHex` | `Buffer` and `btoa` codecs that skip invalid input silently                                                          | `unicorn/prefer-uint8array-base64`, `-hex` |

Also:

- `Set` methods, iterator helpers and `Promise.try` can now be used, and their existing unicorn rules apply.
- **`unicorn/prefer-iterator-zip` is off.** `Iterator.zip` is missing on Node 26, so following the rule would pass in the app and fail in tests. Revisit when Node's LTS has it. `Iterator.concat` is available at run time but TypeScript does not declare it, so it is not used.
- Streams are decoded as streams. A child's `stdout` and `stderr` get `setEncoding('utf8')` (or a `TextDecoder` with `{ stream: true }`), never `chunk.toString('utf8')` per chunk, which turns a multi-byte character split across two chunks into U+FFFD. The trace runner had this bug.
- `tailOf` drops the lone low surrogate a cut leaves at the start, instead of replacing it with U+FFFD, so the result can be one unit shorter than asked.

Not adopted:

- `Math.sumPrecise` (missing on Node 26), `ReadableStream.from` (missing in the renderer), `Iterator.zip` (see above), `scheduler.yield` (missing in Node and Electron's main) and `import defer` (a syntax error everywhere).
- `Intl.DurationFormat` for shown durations: adopted on 2026-10-30, see the amendment below.
- The RegExp `v` flag, `JSON.rawJSON`, `Float16Array`: no bug class to remove here. New regexes may use `v`.

## Consequences

- Code written for these APIs type-checks, and the old patterns fail lint.
- A corrupted secret in `model-secrets.json` now fails to decode, so the key reads as missing, instead of decoding to garbage bytes that the keychain then rejects.
- Anything that must run in tests must exist on Node 26. Check a new API on `node` 26 and on Electron's Node before adopting it, and keep the table above current.

## Amendment 2026-10-30: `errorFrom` and `Intl.DurationFormat`

### `errorFrom(value)` (`#x/error/error-from.ts`)

Every `catch` normalised its `unknown` by hand (`Error.isError(e) ? e.message : String(e)`, `String(cause)`, `new Error(String(cause))`), and each copy had a different fallback. One function now does it:

- An error, from this realm or another (`Error.isError`), is returned as it is. It is never rewrapped, so its stack, `name` and `cause` survive.
- Anything else becomes a new `Error` with the value as `cause` and the message `Non-error thrown: <description>`: a string is quoted, other primitives print as `String` does, a function is `function name`, an object is its constructor name plus its own string `message` or its first own keys. The description never calls the value's own `toString`, `toJSON` or `Symbol.toPrimitive`, is cut to 200 characters and cannot throw (null-prototype objects, symbols, bigints, revoked proxies and throwing getters are covered by tests).
- Use `errorFrom(e).message` for text and `errorFrom(e)` where a real `Error` is needed (a rethrow, `cause`, a logger field).
- The logger's `replaceErrors` keeps its own `Error.isError` branch because it serialises `name`, `stack` and `cause`; it uses `errorFrom` only for its serialisation-failure fallback.
- Enforced by `local/prefer-error-from`: a conditional that tests `Error.isError(x)` or `x instanceof Error` and has `String(x)` in either branch, and `String(x)` on a `catch` parameter. A conditional with a fixed fallback message (`Error.isError(e) ? e.message : 'The editor could not start.'`) is allowed.
- Side effect: messages that used `String(error)` lose the `Name: ` prefix (`invalid JSON: Unexpected token`, not `invalid JSON: SyntaxError: Unexpected token`).

### `Intl.DurationFormat`

`formatDuration(duration, locale?)` (`#x/time/format-duration.ts`) is the one way to show a `Temporal.Duration` to a person. It rounds to whole milliseconds, balances up to hours (`90s` reads `1m 30s`) and formats in the `narrow` style: `712ms`, `1s 234ms`, `30s`, `1m 30s`, `2h 5m`, `0ms`.

- Converted: the trace and ImpactGate timings and the model test in the renderer, and the timeout sentences for models, traces, `gh` and the hosting API in main.
- ISO-8601 strings still cross IPC and persistence (ADR 0059); only the last step to text changed. The renderer's `formatIsoDuration` parses the contract's string.
- Locale: no argument means the runtime's default, which is the user's language in the renderer and the application locale in main. Functions that format a duration take an optional trailing `locale` so tests can pin it; every test that asserts duration text passes one.
- Availability was probed on Node 26.13, Electron 45's Node 24.22 and Chromium 156. TypeScript 6.0 declares it in `es2025.intl`, which `lib` already includes.
- Enforced by `local/no-hand-formatted-duration`: `.toFixed(…)` on `duration.total(…)` or on a name ending in `Ms`, `Milliseconds` or `Seconds`. No rule covers the `${n} s` templates themselves: there is no reliable syntactic signal for them. Review catches those.
- Not changed: `formatRelativeTime` (`5 min ago`) is a relative time, which `Intl.RelativeTimeFormat` would serve; byte and character sizes are not durations.
