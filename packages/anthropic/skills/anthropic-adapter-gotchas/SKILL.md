---
name: anthropic-adapter-gotchas
description: Gotchas for @veyorhq/anthropic — the two separate adapters (Anthropic API via Effect AI, Claude Code CLI headless mode), the exact-pinned effect beta, ceilingMs timeout semantics, and Claude CLI session behavior. Use when wiring or debugging an actor implementation from @veyorhq/anthropic.
metadata:
  library: "@veyorhq/anthropic"
---

# `@veyorhq/anthropic` gotchas

Two unrelated adapters live in this package — don't reach for the wrong one.

## Two adapters, two import paths

- `@veyorhq/anthropic/anthropic` — an Effect AI model **layer** for
  `@veyorhq/ai-effect`'s `agent(...)`. Use when the actor should call the
  Anthropic API directly.
- `@veyorhq/anthropic/claude` — `claude(actor, model, options)` drives a
  **local Claude Code CLI session** in headless mode (`claude --print`)
  under your own local authentication. These are not interchangeable:
  the CLI adapter needs Claude Code installed and authenticated on the
  machine running the factory; the API adapter needs `ANTHROPIC_API_KEY`.

## Exact-pinned effect beta

`effect` is pinned to the exact string `4.0.0-beta.103` (dependency,
peerDependency, and peerDependenciesMeta all agree) — not a caret or range.
This is a beta-series API surface; installing a different `4.0.0-beta.*`
elsewhere in the dependency tree is a likely source of type or runtime
mismatches (e.g. a schema helper existing in one beta but not another).
Keep it in lockstep with the other `@veyorhq/*` packages, which pin the
same exact version.

## `ceilingMs` is a hard external bound, not the machine's retry policy

`claude(actor, model, { ceilingMs })` is an absolute wall-clock bound on one
worker invocation: on expiry the child process is killed and the run
rejects with `ClaudeCeilingError`. This is independent of the machine's own
`retries` policy — a `ceilingMs` timeout is a failure that policy can then
retry, not a substitute for it. Leave it unset only when a station has no
natural time budget; an unbounded model CLI invocation can hang
indefinitely on network stalls or tool-use loops with nothing else watching
it. The child is also killed if the task's `AbortSignal` fires (the run
being cancelled), independent of `ceilingMs`.

## Claude CLI sessions are single-shot

Each `claude()` invocation runs with `--no-session-persistence`: a fresh
session per call, no conversation carried between actor invocations. Don't
expect one actor's Claude Code session to remember a prior one's — context
an actor needs must come through its `input`/`context` contract, not
implicit session memory. Options map onto CLI flags directly: `effort`,
`instructions` (`--append-system-prompt`), `permissionMode`,
`allowedTools`/`disallowedTools`, `maxBudgetUsd`, `cwd` — see
`packages/anthropic/README.md` for the full option-to-flag mapping.

## Where to look next

- `packages/anthropic/README.md` — usage examples for both adapters.
- `packages/anthropic/src/claude.ts` — `ClaudeOptions`, the CLI arg
  builder, and the result-envelope parsing this adapter relies on.
