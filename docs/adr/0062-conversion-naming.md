# 0062. Conversions are `x.toY()` or `yFrom(x)`

- Status: Accepted
- Date: 2026-10-30

## Context

Conversions between types were named `toY(x)`, `rowToY(row)` and `yFromX` interchangeably, so the name did not say which side owned the conversion and autocomplete could not list them.

## Decision

- An **instance method** that converts types is `x.toY()`.
- A **static method or standalone function** that converts types is `yFrom(x)`, or `yFromX(x)` / `Y.fromX(x)` when the source is not polymorphic.
- `parse…` stays for validating untrusted input.
- Lint (`no-restricted-syntax` in `eslint.config.js`) bans standalone or static functions named `to[A-Z]…` and instance methods named `from[A-Z]…`. The capital letter keeps `toggle`, `total`, `tokenize` and `today` legal. Infix names (`rowToCheckpoint`) are a written guideline only: too many false positives (`scrollToHunk`, `jumpToCitation`, `addToChat`) for a rule. They are renamed to `checkpointFromRow`.

Reasons:

1. Autocomplete. With an `x`, typing `x.to…` surfaces every outgoing conversion; near `Y`, typing `Y.from…` or `yFrom…` surfaces every incoming one.
2. Grammar. `x.toY()` is an action the object performs ("convert yourself to Y"); `Y.fromX(x)` addresses the destination ("Y, build yourself from X").

Prior art: Rust ([API Guidelines C-CONV](https://rust-lang.github.io/api-guidelines/naming.html#ad-hoc-conversions-follow-as_-to_-into_-conventions-c-conv): `to_string()` on the source, `String::from`, `Vec::from_iter` on the target) and .NET ([Framework Design Guidelines](https://learn.microsoft.com/dotnet/standard/design-guidelines/): instance `ToString()`, `ToArray()`; static factories such as `TimeSpan.FromSeconds`). `System.Convert.ToInt32` is a counterexample beuve deliberately does not follow.

## Consequences

Every existing `toY(x)` function and `xToY` helper is renamed, and files named `to-y.ts` become `y-from.ts` (one runtime export per file, named after the file). External API names and names a library requires (`toJSON`, `toString`) are untouched.
