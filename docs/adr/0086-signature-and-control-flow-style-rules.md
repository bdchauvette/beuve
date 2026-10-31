# 0086. Style rules for ternaries, arrow bodies and function signatures

- Status: Proposed
- Date: 2026-10-31

## Context

Four patterns keep producing code that is hard to read or easy to get wrong: ternaries in logic, expression-bodied arrows that hide a multi-line or side-effecting body, object types written inline in a signature, and several positional parameters of one type that a call can swap without a compile error.

## Decision

Phase 1 (this change) adds the rules and their tests, registered at level `off` in `eslint.config.js` (block `beuve/style-rules-phase-2`). Phase 2 switches them on and fixes the whole repo in one change, once other work has landed. This ADR stays Proposed until then.

Rules to enable in phase 2:

- **`local/no-ternary-outside-templates`** replaces core `no-ternary`. A conditional expression is allowed only in an expression slot of a Lit `html` or `svg` tagged template (text, attribute, property and boolean bindings), with no function boundary between the two, so a ternary in a `.map` callback inside a template is reported. The tag must be `html`/`svg` and, when imported, come from `lit`/`lit-html`. TypeScript conditional types are unaffected. No autofix. **Lit ternaries are allowed** because they are the idiom for bindings.
- **`no-nested-ternary`** (core) forbids nesting everywhere, templates included.
- **`local/arrow-body-braces`** allows an expression-bodied arrow only when it is one line, not followed by a comma (a list element, argument or property), and a simple expression: identifier, literal, member chain, call with simple arguments, unary, binary or logical of simple operands, or a template literal without functions. Everything else (object literal, nested function, assignment, sequence, conditional, `await` chain) gets a block. The autofix keeps comments, and writes a bare statement instead of `return` when the return type is `void` (or `Promise<void>` for an async arrow) or the body is a `void` expression. Run Prettier after the fix.
- **`local/no-inline-object-type-in-signature`** reports any object type literal inside a parameter type or return type, nested ones included (`Promise<{…}>`, `(e: {…}) => void`), for functions, methods, constructors, and call, construct and method signatures. Name the type. No autofix. The filter argument of `Extract` and `Exclude` (`Extract<SessionError, { kind: 'corrupt-row' }>`) is exempt: it picks union members rather than describing a shape.
- **`local/no-same-type-positional-params`** (type-aware) reports two or more positional parameters of the identical type, unless the function has exactly two parameters whose names form an allowlisted pair. The pairs are the rule option `allowedPairs`; the default is a/b, first/last, left/right, lhs/rhs, x/y, before/after, previous/next, old/new, start/end, min/max, actual/expected, compared case-insensitively, ignoring a leading underscore, in either order. **`from`/`to` is deliberately not allowed** (the order is the whole point and is easy to swap); **`actual`/`expected` is** (tests read both ways). Exempt: a function passed directly as a call argument (the library dictates it), a method that implements an interface or has `override`, and overloads.
- **`curly: ['error', 'all']`** and **`@typescript-eslint/max-params: ['error', { max: 3 }]`** (core `max-params` stays off).

## Consequences

- Phase 2 is a repo-wide mechanical change plus manual renames of types and parameter lists. Violation counts are measured in the phase 1 change.
- Options objects with named types replace long positional lists, so call sites read as `{ from, to }`.
- Code in `.map` callbacks inside templates can't use `?:`; extract a helper or use `nothing`/`&&`.
- Interface-dictated signatures keep their shape through the implements/override exemption, but the interface itself is still checked.
