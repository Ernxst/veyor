---
name: opencode-adapter-gotchas
description: Gotchas for @veyorhq/opencode — closed stdin to avoid hangs, --dir confinement (opencode ignores child process cwd), prompt-stated + validated output (no schema enforcement), exact-pinned effect beta, and ceilingMs semantics. Use when wiring or debugging an actor implementation from @veyorhq/opencode.
metadata:
  library: "@veyorhq/opencode"
---

# `@veyorhq/opencode` gotchas

`@veyorhq/opencode` runs a Veyor actor through the local `opencode` CLI in
non-interactive mode (`opencode run`), reaching every provider opencode is
authenticated with — including its free model tier.

## stdin is closed explicitly — don't undo that

`opencode run` merges piped stdin into the prompt and waits for EOF before
proceeding. The adapter spawns the child with `stdin: "ignore"` specifically
to avoid the run hanging on an open stdin pipe. If you're extending or
forking this adapter, keep stdin closed — reopening it to "pass more
context" will hang every run instead.

## `--dir`, not child process `cwd`, confines opencode

opencode resolves its own working directory internally and **ignores the
child process's `cwd`** — passing only `options.cwd` to the spawned process
would not confine it. The adapter passes `--dir` explicitly as the
sanctioned way to scope opencode to a directory. If you add options to this
adapter, route any directory-confinement need through `--dir`, not through
the spawn call's `cwd`.

## No schema-enforced output — the contract lives in the prompt

Unlike the Claude Code and Codex adapters, opencode has no structured-output
flag. The actor's output contract is serialized into the prompt as JSON
Schema with an explicit "respond with ONLY a single JSON object, no prose,
no markdown fences" instruction, then the response is extracted (fenced or
bare) and validated against the contract. A validation failure throws,
landing in the machine's retry policy. This makes the adapter a good fit
for cheap models where "validate + let the machine retry" is an acceptable
trade for cost — it is a materially weaker guarantee than the other two
adapters' schema-enforced output, so don't assume parity when swapping an
actor's implementation from `claude()`/`codex()` to `opencode()`.

## Exact-pinned effect beta

`effect` is pinned to the exact string `4.0.0-beta.103` — dependency,
peerDependency, and peerDependenciesMeta all agree, not a range. Keep it in
lockstep with the other `@veyorhq/*` packages.

## `ceilingMs` is a hard external bound, not the machine's retry policy

`opencode(actor, model, { ceilingMs })` is an absolute wall-clock bound: on
expiry the child is killed and the run rejects with `OpencodeCeilingError`.
This is independent of the machine's own `retries` policy — treat a ceiling
expiry as a failure for policy to retry, not a substitute for it. The child
is also killed if the task's `AbortSignal` fires, independent of `ceilingMs`.

## `opencodePreset` is sugar, not a separate code path

When every actor in an assembly shares a model/cwd, `opencodePreset({...})`
captures that once; per-call options (including `model`) shallow-merge over
the preset with the per-call value winning. No behavior differs from
calling `opencode()` directly with the same merged options.

## Where to look next

- `packages/opencode/README.md` — usage and option reference.
- `packages/opencode/src/opencode.ts` — `OpencodeOptions`, the `--dir`/arg
  builder, and the prompt-extraction/validation path.
