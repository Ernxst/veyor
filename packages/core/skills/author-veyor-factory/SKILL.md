---
name: author-veyor-factory
description: Author a Veyor factory with @veyorhq/core — the four-file spine (schema, actors, blueprint, assemblies), schema conventions (Schema.Finite, withDecodingDefaultKey, JSON-Schema-capable contexts), the outcome/transition contract, judgment-vs-policy placement, guard purity, bounded loops, and the free-floor pattern. Use when creating, reviewing, or refactoring a Veyor blueprint, actors, or assemblies.
metadata:
  library: "@veyorhq/core"
---

# Authoring a Veyor factory

A Veyor factory is a typed state machine (`machine()` from `@veyorhq/core`) whose
stations (`task()`) are staffed by actors, routed by outcome-driven
`transition()`s, and terminated by `sink()`s. This skill is judgment and
convention — for exact function signatures, read `packages/core/README.md`
and the source under `packages/core/src/modules/`.

## The four-file spine

One prescribed shape, one concept per file:

```
veyor.config.ts        # the CLI surface
src/
  schema.ts             # contracts: the context and every station's input/output
  actors.ts             # roles: named capabilities over those contracts
  blueprint.ts           # the machine: stations, routing, guards, policy constants
  assemblies/
    <name>.ts            # one file per assembly; default export = assemble(blueprint, ...workers)
```

**Import direction is the rule**: each file imports only from the files above
it in this list. `schema.ts` imports nothing project-local. `actors.ts`
imports only `schema.ts`. `blueprint.ts` imports `actors.ts` and `schema.ts`.
`assemblies/*.ts` imports `actors.ts` and `blueprint.ts`. If an import points
the other way — e.g. `schema.ts` reaching into `actors.ts` — something is
in the wrong file. Growth is by splitting a file into a same-named directory
(`src/schema/` with one file per station), never by inventing a new top-level
concept.

`schema.ts` is the whole model — contracts _and_ the pure operations over
them (backlog queries, derived predicates). Don't split those into a
`helpers.ts`; they belong next to the types they operate on.

## Order of work

Build in spine order: **model → actors → blueprint → assemblies → config.**
Nail the context and task contracts first (what data exists, what every
station consumes and produces); only then name the roles that fill those
contracts; only then wire the state machine; only then bind concrete workers
and CLI surface. Working out of order — e.g. writing a blueprint before the
output contracts it routes on exist — produces stations with no real outcome
set to transition on.

## Schema conventions

- Context schemas must be **JSON-Schema-capable**: the CLI reads each arg's
  primitive type off the machine's JSON Schema. Standard-Schema-native
  vendors (valibot, typebox) pass to `machine()`/`actor()` raw — they are
  upgraded on construction. Effect schemas need an explicit adapter:
  `schema()` from `@veyorhq/core/schema/effect` (also `schema/typebox`,
  `schema/valibot` exist for those vendors' own adapters).
- Numeric fields the CLI can set from the command line use `Schema.Finite`,
  not `Schema.Number` — the CLI's JSON-Schema-driven arg parser needs a
  concrete numeric kind (`number`/`integer`) to build the right flag parser.
- Give every field with a sane default `Schema.withDecodingDefaultKey(Effect.succeed(value))`
  so callers can omit it entirely — a fresh run, a CLI invocation, or an
  agent re-run with a partial context all decode cleanly without the caller
  restating zero-values (`spend: 0`, `attempts: 0`, `backlog: []`, ...).
  This is what makes `veyor run "<task>"` work with nothing but a positional
  arg: everything else defaults.

## Outcomes and transitions

Every actor's output type is a union whose members share an `outcome`
string-literal field (or a single struct with one literal `outcome`, for
actors with exactly one result shape). `transition(from, to, { on, when? })`
routes on that literal. A task with multiple assignments (multiple candidate
actors, selected by `when` guards on the assignment) can still route
uniformly, because every candidate actor shares the same output union.

Keep the outcome set the actual decision surface: don't add an outcome that
no transition consumes, and don't route on context state that isn't yet in
the outcome (push it into the actor's output type instead of reaching around
it in a transition guard where avoidable).

## Judgment vs. policy

Give an actor a model-backed implementation only where genuine judgment is
being exercised — planning, review, triage, anything where "the right answer
depends on reading the specifics." Scheduling, integration, and other
mechanically-decidable steps (selecting the next ready backlog item, merging
and running checks, tallying a gate) are **deterministic** — implement them
with `deterministic()` from `@veyorhq/core/actors`, not a model call. A
model call for a deterministic decision is not just wasted spend; it makes
the step nondeterministic where the system needs it not to be.

## Guards: pure and declaration-order

Transition and assignment `when` guards must be pure, synchronous functions
of context (and, for assignment guards, `meta.retryCount`). They run after
the actor's `update` has folded its output into context — so a guard can see
what just happened, but must not perform side effects. Transitions are
evaluated in **declaration order**; the first whose `on` matches the emitted
outcome and whose `when` passes (or is absent) wins. Order matters:
put the more specific guard first when two transitions could otherwise both
match on the same outcome.

## Bounded loops and exhaustion-as-evidence

Any retry/refine loop (implement → review → refine → review → ...) needs an
explicit bound in the guard, tracked in context (an `attempts` counter, a
per-item spend cap). Don't let a loop run until an external timeout kills
the whole run. When the bound trips, that's not a dead end — it's _evidence_:
route to triage (or an equivalent judgment station) so a model actor can
decide whether to respec, split, defer, or escalate, rather than silently
looping forever or silently giving up.

## Ambient outcomes: blocked and contradiction

Let any working actor surface two outcomes ambiently, without every task
having to special-case them: `blocked` (raises a question for the user —
route it to an ask-user station) and `contradiction` (the work as specified
conflicts with the plan — route it to triage). These stay outcomes on the
actor's output type, never scheduler discretion baked into a deterministic
worker's control flow — a deterministic worker doesn't get to decide the run
is stuck; only the actor whose job it is to notice does.

## The free-floor pattern

When a station's usual actor is a model call, but some fraction of inputs
are mechanically decidable without judgment (e.g. a trivial, low-risk
backlog item's review), give that station a second, `deterministic()`
assignment guarded to the mechanically-decidable case and ordered so it
wins when it applies. This is the free floor: the deterministic assignment
is unmetered (no `spend` charge) and never fails for judgment reasons, so
routine work never pays for or waits on a model. See
`examples/software-factory/src/blueprint.ts` for `gateTier`-guarded
`GateReviewer`/`GateVerifier`/`AutoAcceptance` assignments as a full
worked example of this pattern alongside its model-backed counterpart.

## Where to look next

- `packages/core/README.md` — full API reference (`machine`, `task`, `sink`,
  `transition`, `assign`, `actor`, schema adapters).
- `packages/cli/README.md` — the "Project structure" section this skill's
  spine mirrors, and how `veyor.config.ts` exposes a factory to the CLI.
- `examples/software-factory/` — a complete, non-trivial worked example of
  every convention above.
