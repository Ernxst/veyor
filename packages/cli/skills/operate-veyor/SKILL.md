---
name: operate-veyor
description: Operate a Veyor factory from the CLI — run/simulate/inspect, --quiet/--json/--record/--resume, reading narration output, and the agent-caller loop (headless assemblies, stateless re-runs with --backlog/--decisions-style args, decisions pre-seeding). Use when running, driving, embedding, or debugging a Veyor factory via `veyor`.
metadata:
  library: "@veyorhq/cli"
---

# Operating a Veyor factory

`@veyorhq/cli` is the runtime host: `veyor run|simulate|inspect` against a
project's `veyor.config.ts`. This skill is judgment about _how to drive it_
— for full flag/behavior reference, read `packages/cli/README.md`.

## The three commands

- **`veyor run [args] [--assembly <name>] [--context base.json] [--seed n] [--json] [--quiet] [--record path] [--resume path]`**
  — assembles the initial context, runs the factory, prints
  `{ task, context }` on stdout, and exits nonzero when the sink is not in
  `run.success`.
- **`veyor simulate [args] [--runs n] [--seed n]`** — runs the factory many
  times against a seeded assembly and prints a sink/failure tally plus
  numeric-field `{ mean, min, max }` stats. Never fires real (model-backed)
  workers — it defaults to the config's sole seed-parameterized assembly,
  not `run.assembly`.
- **`veyor inspect [--mermaid]`** — prints the blueprint's stations, actors,
  and transitions as text or a Mermaid state diagram. Use this first when
  approaching an unfamiliar factory — it's the fastest way to see the whole
  shape before reading `blueprint.ts`.

## Flags that change what you see, not what runs

- `--quiet` hides worker activity narration (tool runs, edits, text, usage
  reports) and shows only station-level events (`invoke`, `complete`,
  `transition`, `retry`, `error`). Use it once you trust a factory and only
  want the shape of the run.
- `--json` switches text narration for NDJSON events on stderr, one line per
  event with an `at` epoch-ms timestamp — this is the embedding format, not
  a debugging convenience. Text mode's 60s-silence heartbeat line is
  suppressed in `--json` mode by design; an embedder should track liveness
  from event timestamps instead.
- Default text mode brackets a run with a header
  (`▶ <machine id> · assembly <name>[ · seed <n>]`) and footer
  (`■ <sink> in <duration>`) line — grep for `■` to find where a run landed
  in a long log.

## Reading narration

Station-level events (`invoke`, `complete`, `transition`, `retry`, `error`)
are always shown, even under `--quiet`. Between `invoke` and `complete` for
a given station, agentic adapters (Claude Code, Codex, opencode) report
`activity` events through the task's `report()` callback — tool calls, file
edits, streamed text, usage. A `retry` event means the task's actor threw or
the machine's retry policy (`retries` in `machine()`) kicked in — check
whether the actor is flaky (transient network) or the retry is masking a
contract mismatch (validation failing every time, burning through the
retry budget). If a run goes 60s without any event in text mode, a status
line prints and repeats every further 60s — this is liveness, not a hang,
but a worker legitimately stuck (waiting on something outside the process)
looks identical to a slow one, so use it as a hint to check the process the
worker is driving, not a definitive diagnosis.

## Crash-safe runs: --record / --resume

`--record <path>` writes a run as NDJSON: a header line (machine id +
decoded initial context) then one timestamped event per line, appended
**synchronously** as the run progresses — a killed process still leaves a
usable partial record up to the last completed step. `--resume <path>`
replays those recorded events (no workers re-invoked for steps already
recorded) and goes live from where the record ends. Combine `--resume` with
a fresh `--record` target to leave a standalone record of the resumed run.
Use this for anything long-running or expensive enough that losing progress
to a crash or an interrupt is costly — most model-backed assemblies qualify.

## The agent-caller loop

An unattended (headless) assembly holds its authority boundaries — the
questions a human would normally answer, budget-exhaustion sign-off — in
policy instead of blocking on a human. Anything policy can't resolve on its
own comes back in the _result_: deferred backlog items, a decision log,
findings. The calling agent reads that result and re-runs the factory with
the gaps filled in — typically a `--context base.json` carrying forward the
prior run's context, with the caller's answers folded into a `decisions`
(or equivalent, project-specific) field before re-invoking. Each invocation
is stateless from the CLI's point of view: **the re-run loop _is_ the
conversation.** Don't look for a "resume this ambiguous run" flag distinct
from `--resume` (which replays mechanical machine state, not a paused
decision) — the pattern is: run headless → inspect the result for what's
still open → re-run with that filled in → repeat until the sink is a
success sink.

For a caller that already knows a task's decomposition (a planner agent
upstream, say), pass it as part of the initial context so the factory's own
planning station adopts it for free instead of re-deriving it with a model
— see how the software-factory example's `plan` task assigns a
`PlanAdopter` when the caller-supplied backlog is already present.

## Where to look next

- `packages/cli/README.md` — full command/flag reference and the config
  contract (`defineConfig`, `ArgSpec`, `RunConfig`).
- `examples/software-factory/src/assemblies/headless.ts` — a complete
  unattended assembly: policy answering `askUserQuestion` conservatively,
  deferring on budget exhaustion, auto-accepting a verified delivery.
