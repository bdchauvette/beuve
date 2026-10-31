# 0086. Style rules for ternaries, arrow bodies and function signatures

- Status: Accepted
- Date: 2026-10-31

## Context

Four patterns keep producing code that is hard to read or easy to get wrong: ternaries in logic, expression-bodied arrows that hide a multi-line or side-effecting body, object types written inline in a signature, and several positional parameters of one type that a call can swap without a compile error.

## Decision

Phase 1 added the rules and their tests at level `off`. Phase 2 fixed the repo area by area and switched them on for the whole repo in `eslint.config.js` (block `beuve/style-rules`).

The user decided the open questions:

- Ternaries are allowed directly in Lit template slots, and nowhere else; nested ternaries nowhere.
- Of the same-type parameter pairs, `from`/`to` and `then`/`now` are excluded; `actual`/`expected` and `key`/`value` are included.
- A function whose signature something else dictates, a library's callback passed as an argument or the value of an explicitly typed binding, is exempt from `max-params` as well as from the same-type rule.

The rules:

- **`local/no-ternary-outside-templates`** replaces core `no-ternary`. A conditional expression is allowed only in an expression slot of a Lit `html` or `svg` tagged template (text, attribute, property and boolean bindings), with no function boundary between the two, so a ternary in a `.map` callback inside a template is reported. The tag must be `html`/`svg` and, when imported, come from `lit`/`lit-html`. TypeScript conditional types are unaffected. No autofix. **Lit ternaries are allowed** because they are the idiom for bindings.
- **`no-nested-ternary`** (core) forbids nesting everywhere, templates included.
- **`local/arrow-body-braces`** allows an expression-bodied arrow only when it is one line, not followed by a comma (a list element, argument or property), and a simple expression: identifier, literal, member chain, call with simple arguments, unary, binary or logical of simple operands, or a template literal without functions. Everything else (object literal, nested function, assignment, sequence, conditional, `await` chain) gets a block. The autofix keeps comments, and writes a bare statement instead of `return` when the return type is `void` (or `Promise<void>` for an async arrow) or the body is a `void` expression. Run Prettier after the fix.
- **`local/no-inline-object-type-in-signature`** reports any object type literal inside a parameter type or return type, nested ones included (`Promise<{…}>`, `(e: {…}) => void`), for functions, methods, constructors, and call, construct and method signatures. Name the type. No autofix. The filter argument of `Extract` and `Exclude` (`Extract<SessionError, { kind: 'corrupt-row' }>`) is exempt: it picks union members rather than describing a shape.
- **`local/no-same-type-positional-params`** (type-aware) reports two or more positional parameters of the identical type, unless the function has exactly two parameters whose names form an allowlisted pair. The pairs are the rule option `allowedPairs`; the default is a/b, first/last, left/right, lhs/rhs, x/y, before/after, previous/next, old/new, start/end, min/max, actual/expected, key/value, compared case-insensitively, ignoring a leading underscore, in either order. **`from`/`to` is deliberately not allowed** (the order is the whole point and is easy to swap), **nor is `then`/`now`**; **`actual`/`expected` is** (tests read both ways), **and so is `key`/`value`** (the map convention everyone reads the same way). Exempt: a function whose signature something else dictates (below), a method that implements an interface or has `override`, and overloads.
- **`curly: ['error', 'all']`** and **`local/max-params: ['error', { max: 3 }]`**: typescript-eslint's `max-params` (same count and options, `this: void` not counted) with the dictated-signature exemption, which typescript-eslint's rule has no option for. Core `max-params` and `@typescript-eslint/max-params` stay off.
- **Dictated signatures**, exempt from both `local/max-params` and `local/no-same-type-positional-params` through one predicate (`eslint-local-rules/is-signature-dictated.ts`): a function or arrow expression passed directly as a call or `new` argument (a library's callback shape, such as a `String.replaceAll` replacer); the initializer of a variable declarator with a type annotation (`const frobnicate: Frobnicator = function (…) {…}`); the value of a class property with a type annotation; the operand of `satisfies`; and a property value of an object literal that is itself one of those. The type that dictates the shape is still checked.

## Consequences

- Phase 2 is a repo-wide mechanical change plus manual renames of types and parameter lists. Violation counts are measured in the phase 1 change.
- Options objects with named types replace long positional lists, so call sites read as `{ from, to }`.
- Code in `.map` callbacks inside templates can't use `?:`; extract a helper or use `nothing`/`&&`.
- Interface-dictated signatures keep their shape through the implements/override exemption, but the interface itself is still checked.
