---
name: openai-adapter-gotchas
description: Gotchas for @veyorhq/openai — the two separate adapters (OpenAI API via Effect AI, Codex CLI), the exact-pinned effect beta, ceilingMs timeout semantics, sandbox modes, and codex.preset. Use when wiring or debugging an actor implementation from @veyorhq/openai.
metadata:
  library: "@veyorhq/openai"
---

# `@veyorhq/openai` gotchas

Two unrelated adapters live in this package — don't reach for the wrong one.

## Two adapters, two import paths

- `@veyorhq/openai/openai` — an Effect AI model **layer** for
  `@veyorhq/ai-effect`'s `agent(...)`. Reads `OPENAI_API_KEY` through Effect
  `Config`; missing/invalid config fails when the layer is used.
- `@veyorhq/openai/codex` — `codex(actor, model, options)` runs a Veyor
  actor through the local **Codex CLI** (`codex exec`) with structured
  output enabled. Needs the Codex executable installed, authenticated, and
  on `PATH` — this adapter does not go through the OpenAI API directly.

## Exact-pinned effect beta

`effect` is pinned to the exact string `4.0.0-beta.103` across dependency,
peerDependency, and peerDependenciesMeta — not a range. Keep it in
lockstep with the other `@veyorhq/*` packages; a mismatched beta elsewhere
in the tree is a likely source of subtle type/runtime breaks.

## `ceilingMs` is a hard external bound, not the machine's retry policy

`codex(actor, model, { ceilingMs })` is an absolute wall-clock bound: on
expiry the child `codex exec` process is killed and the run rejects with a
codex timeout error. This is independent of the machine's own `retries`
policy — treat a ceiling expiry as a failure for policy to retry, not a
substitute for retry policy. Leave a station's model call unbounded and a
network stall or runaway tool loop has nothing else watching it.

## Sandbox is a real trust boundary, not a formality

`sandbox` selects `read-only`, `workspace-write`, or
`danger-full-access`. The adapter's own default is `workspace-write` — set
a narrower sandbox (`read-only`) for actors that only need to read/reason,
not just because the actor's prompt says not to write. The CLI enforces
the sandbox; the prompt does not.

## Structured output goes through a temp file, not stdout parsing

The adapter converts the actor's output contract to JSON Schema, writes it
to a scoped temporary directory, and passes it to `codex exec` for
schema-enforced structured output — unlike the opencode adapter (see
`@veyorhq/opencode`'s gotcha card), there is no "extract JSON from prose"
step here. A validation failure means the _contract_ is wrong for what the
model can produce, not that extraction failed.

## `codex.preset` is sugar, not a separate code path

When several actors share a model/effort/sandbox, `codex.preset({...})`
captures that once and returns a constructor; per-call options shallow-merge
over the preset with the per-call value winning. It's pure convenience over
`codex(...)` — no behavior differs from calling `codex()` directly with the
same merged options each time.

## Where to look next

- `packages/openai/README.md` — full option tables for both adapters.
- `packages/openai/src/codex.ts` — `CodexOptions`, the CLI arg builder,
  and structured-output parsing.
