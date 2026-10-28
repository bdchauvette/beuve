# 0003. Lit for the UI layer

- Status: Accepted
- Date: 2026-10-28

## Context

The spec says both "Vanilla JavaScript and Standard Custom Elements" and "Vanilla Web Components & Lit renderer layer", and enables eslint-plugin-lit. We have to pick one.

## Decision

Use Lit (v3) for renderer components. Components are still standard custom elements; Lit supplies reactive properties and efficient templating. No React, no Monaco.

## Consequences

One small runtime dependency (~5 KB) in the renderer bundle instead of a hand-rolled templating layer to maintain. Lint config keeps eslint-plugin-lit and eslint-plugin-wc. Lit stays out of `src/pkg`, `src/internal` and `src/main`.
