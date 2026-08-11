---
name: cursor-adapter-gotchas
description: Gotchas for @veyorhq/cursor — auth is ambient (login/CURSOR_API_KEY) and not verified live, --force is required to avoid headless approval hangs, --workspace confinement was inferred from --help not confirmed, stream-json narration relies on the terminal result event, closed stdin, exact-pinned effect beta, and ceilingMs semantics. Use when wiring or debugging an actor implementation from @veyorhq/cursor.
metadata:
  library: "@veyorhq/cursor"
---

# `@veyorhq/cursor` gotchas

`@veyorhq/cursor` runs a Veyor actor through the local `cursor-agent` CLI in
non-interactive print mode (`cursor-agent -p`). This adapter was built
against an **unauthenticated** `cursor-agent` install — every `cursor-agent`
invocation attempted during development failed immediately with `Error:
Authentication required. Please run 'agent login' first, or set
CURSOR_API_KEY environment variable.` (exit code 1), before emitting any
output on any `--output-format`. The facts below are split by how they were
established.

## Verified empirically (unauthenticated `cursor-agent`, version `2026.08.11-e8db854`)

- `cursor-agent --help` output: flag names, defaults, and descriptions
  quoted in this adapter's source are copied verbatim from `--help`.
- `-p`/`--print` plus any `--output-format` (`text`, `json`, `stream-json`)
  all fail identically and immediately when unauthenticated — no output is
  buffered or streamed before the auth check, on stdout or stderr.
- Piping to stdin (`echo hi | cursor-agent -p ...`) does not change the
  above; the auth check happens before stdin (if any) is consumed, so
  stdin-hang behavior specifically could **not** be observed either way.
- `cursor-agent status`/`whoami` reports `Not logged in`; `cursor-agent
about` reports the CLI version and confirms no account is attached.

## Docs-derived, not live-verified

Everything about the shape of a _successful_ run — because no successful
run was possible in this environment:

- **`--output-format stream-json` event shapes.** `system`/`init`,
  `user`, `assistant` (with `message.content[]` text parts), `tool_call`
  (`subtype: "started" | "completed"`, keyed by tool name like
  `readToolCall`/`writeToolCall`), and the terminal `result` event
  (`result: "<full text>"`, `duration_ms`, `is_error`) are all taken from
  `https://cursor.com/docs/cli/reference/output-format`. The adapter reads
  only `assistant` (for narration), `tool_call` `started` events (for
  narration), and `result` (for the canonical final text) — it does not
  attempt to parse `system`/`user` events or `tool_call` `completed`
  payloads, since nothing here depends on them.
- **`--stream-partial-output` is deliberately not used.** A Cursor forum
  thread (`stream-partial-output: assistant events have multiple
undocumented forms`) reports that partial-output delta events vary in
  shape depending on `timestamp_ms`/`model_call_id` presence, and that the
  `result` event is the reliable source of the final answer regardless.
  This adapter takes exactly that advice: no `--stream-partial-output`,
  and `result.result` (falling back to accumulated `assistant` text only
  if the stream is cut short) is the only text ever validated against the
  actor's contract.
- **`--workspace` as the confinement flag.** `--help` documents
  `--workspace <path-or-name>` as defaulting to "current working
  directory", which reads as the cursor-agent analog of opencode's
  `--dir`. Unlike the opencode adapter, this could not be confirmed to
  actually override the spawned child's own `cwd` (or to be necessary at
  all, given the documented default) — the adapter passes both the
  spawn's `cwd` and `--workspace` for defense in depth. If you're
  debugging a `cwd` confinement issue, this is the first thing to
  re-verify against a real, authenticated run.
- **`--force` avoiding a headless hang.** Cursor's own headless-scripting
  docs pattern is `agent -p --force "..."`, and `--force`'s description
  ("Force allow commands unless explicitly denied") strongly implies that
  without it, a tool call needing approval would prompt — which has no
  answer in a non-interactive, TTY-less run. This adapter always passes
  `--force`; it is not exposed as an option. This was never observed to
  actually prevent a hang, because no authenticated run got far enough to
  reach a tool call.
- **Auth mechanism.** `cursor-agent login`/`CURSOR_API_KEY` are documented
  auth paths; this adapter manages neither and assumes the ambient
  environment (wherever it runs) is already authenticated — exactly the
  same assumption `@veyorhq/opencode` makes about `opencode`.

If you're picking this adapter up with an authenticated `cursor-agent`,
the highest-value thing to do first is re-run a trivial actor through it
and diff the actual event stream against the shapes above — then delete
this paragraph and the "docs-derived" section once confirmed.

## stdin is closed explicitly — don't undo that

The prompt is passed as a CLI argument, not via stdin. Cursor's docs show
`git diff | agent -p "..."` merging piped stdin into a run, which implies
an inherited-open stdin pipe could hang a run that isn't expecting input.
The adapter spawns with `stdin: "ignore"` to rule this out; keep it closed
if you extend or fork this adapter.

## No schema-enforced output — the contract lives in the prompt

Same as `@veyorhq/opencode`: the actor's output contract is serialized
into the prompt as JSON Schema with an explicit "respond with ONLY a
single JSON object, no prose, no markdown fences" instruction, then the
response is extracted (fenced or bare) and validated. A validation
failure throws, landing in the machine's retry policy — this is a
materially weaker guarantee than a schema-enforced adapter, so don't
assume parity when swapping an actor's implementation to `cursor()`.

## Exact-pinned effect beta

`effect` is pinned to the exact string `4.0.0-beta.103` — dependency,
peerDependency, and peerDependenciesMeta all agree, not a range. Keep it
in lockstep with the other `@veyorhq/*` packages.

## `ceilingMs` is a hard external bound, not the machine's retry policy

`cursor(actor, model, { ceilingMs })` is an absolute wall-clock bound: on
expiry the child is killed and the run rejects with `CursorCeilingError`.
This is independent of the machine's own `retries` policy — treat a
ceiling expiry as a failure for policy to retry, not a substitute for it.
The child is also killed if the task's `AbortSignal` fires, independent
of `ceilingMs`.

## `cursor.preset` is sugar, not a separate code path

When every actor in an assembly shares a model/cwd, `cursor.preset({...})`
captures that once; per-call options (including `model`) shallow-merge
over the preset with the per-call value winning. No behavior differs from
calling `cursor()` directly with the same merged options.

## Where to look next

- `packages/cursor/README.md` — usage and option reference.
- `packages/cursor/src/cursor.ts` — `CursorOptions`, the arg builder, the
  stream-json event narrator, and the prompt-extraction/validation path.
- `packages/opencode/skills/opencode-adapter-gotchas/SKILL.md` — the
  nearest-analog adapter this package was modeled on.
