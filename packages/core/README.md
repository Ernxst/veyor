# `@veyorhq/core`

`@veyorhq/core` is the workflow model behind Veyor. It defines typed actors, tasks, transitions, and machines, then binds them to concrete workers with `assemble`.

Use this package when you want the workflow to survive changes in model, provider, human role, or execution strategy.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

## How it fits

A Veyor application has two parts:

1. A **blueprint** declares the workflow and its contracts.
2. An **assembly** supplies one implementation for every actor in that blueprint.

The blueprint is the durable part. You can assemble it with deterministic code, human prompts, AI adapters, or probabilistic stand-ins without changing its tasks and transitions.

## Example

```ts
import { actor, assemble, assign, machine, sink, task, transition } from "@veyorhq/core";
import { deterministic } from "@veyorhq/core/actors";
import { schema } from "@veyorhq/core/schema/effect";
import * as Schema from "effect/Schema";

const Context = schema(Schema.Struct({ objective: Schema.String }));
const Empty = schema(Schema.Struct({}));
const PlanOutput = schema(
  Schema.Struct({ outcome: Schema.Literal("planned"), summary: Schema.String })
);

const Planner = actor("planner", {
  context: Context,
  input: Empty,
  output: PlanOutput,
});

const Blueprint = machine({
  id: "planning-factory",
  initial: "plan",
  context: Context,
  tasks: [task("plan", assign(Planner)), sink("done")],
  transitions: [transition("plan", "done", { on: "planned" })],
});

const Factory = assemble(
  Blueprint,
  deterministic(Planner, ({ context }) => ({
    outcome: "planned",
    summary: `Plan: ${context.objective}`,
  }))
);

Factory.run({ objective: "Ship a typed workflow" });
```

`assemble` checks at compile time that every actor in the blueprint has an implementation.

Every actor output must contain an `outcome: string`. Define `outcome` with a literal or literal union in the output schema so Veyor can constrain each task's transitions to the outcomes its actors declare.

## Public entry points

| Entry point                    | Purpose                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `@veyorhq/core`                | `actor`, `task`, `sink`, `assign`, `transition`, `machine`, and `assemble`. |
| `@veyorhq/core/actors`         | Deterministic, probabilistic, and terminal-prompt actor implementations.    |
| `@veyorhq/core/schema`         | Standard Schema and JSON Schema helpers.                                    |
| `@veyorhq/core/schema/effect`  | Effect Schema adapter and JSON encoding helpers.                            |
| `@veyorhq/core/schema/typebox` | TypeBox adapter.                                                            |
| `@veyorhq/core/schema/valibot` | Valibot adapter.                                                            |

## Actor implementations

### Deterministic

Use `deterministic` for ordinary synchronous or promise-based TypeScript. Veyor validates the returned value against the actor's output contract.

```ts
const PlannerImpl = deterministic(Planner, ({ context }) => ({
  outcome: "planned",
  summary: `Plan: ${context.objective}`,
}));
```

### Probabilistic

Use `probabilistic` to exercise a workflow without paying for real workers. It can generate values from an actor's JSON Schema, fail at a configured rate, choose weighted outcomes, and replay seeded runs.

```ts
import { probabilistic } from "@veyorhq/core/actors";

const PlannerSimulation = probabilistic(Planner, {
  seed: 42,
  failureRate: 0.05,
});
```

### Human prompt

Use `prompt` for a terminal-owned authority boundary. The package includes `question()` and `review()` formats.

```ts
import { prompt, question } from "@veyorhq/core/actors";

const AskUserImpl = prompt(AskUser, { format: question() });
```

The question or review payload is derived from machine context through the assignment's `input` function:

```ts
task(
  "ask-user-question",
  assign(AskUser, { input: (context) => ({ question: context.pendingQuestion }) })
);
```

## Schema adapters

Actor inputs and outputs use the Standard Schema contract. Veyor includes adapters for:

- Effect Schema through `schema(...)`;
- TypeBox through `typebox(...)`;
- Valibot through `valibot(...)`.

Use a schema that can also produce JSON Schema when an implementation needs structured generation, such as `probabilistic` or the Codex adapter.

## Assignments

`assign(actor, options)` accepts three optional hooks, all typed by the actor's contracts:

- `when` selects between several assignments on a task, using context and `meta.retryCount`;
- `input` derives the actor's input from machine context;
- `update` folds the actor's validated output back into machine context.

A bare predicate remains shorthand for `{ when }`. Failed invocations are retried up to the machine's `retries` (default 2), re-running assignment selection each time so repeated failure can escalate to a more capable actor; exhausting retries rejects the run with the actor's error.

`Factory.run(context)` validates the context against the machine contract, runs the machine, and resolves with `{ task, context }` — the sink it stopped at and the final context.

## Observing a run

`run(context, { observer })` streams progress events — `invoke` (carrying the derived input), `activity`, `complete` (with outcome, the validated output, and duration), `transition` (with the chosen edge), `retry`, and `error` — as the machine executes. Because `invoke` and `complete` carry input and output, the event stream is a complete record of the run, not just a progress ticker.

`activity` events narrate what a worker does inside a single invocation — tool runs, edits, model text, token usage — reported through `Task.Input.report(detail, data?)`, an optional hook passed to every invocation. Deterministic workers ignore it and stay silent; the agentic adapters (`@veyorhq/anthropic`, `@veyorhq/openai`, `@veyorhq/opencode`) call it as they stream their CLI's own events. The built-in `textObserver` renders `activity` events as indented `·` lines under the invoking task.

### Replay

`run(context, { replay })` takes an event list recorded from an earlier run over the _same_ initial context — typically the events collected by an `observer` on a prior call. Invocations the record covers return their recorded output instead of running the worker, re-emitted to the observer with `replayed: true`; the first invocation past the end of the record runs live, and later ones after it. If the machine selects an actor the record doesn't expect at that point — a changed blueprint, or an original run whose retries escalated across assignments — replay fails loudly rather than folding the wrong output into context.

## Transitions

`transition(from, to, { on, when? })` routes on the actor's declared `outcome`, and optionally on context. Guarded transitions let policy live on edges instead of dedicated policy tasks — a budget gate or a bounded retry loop is a guard plus an unguarded fallback:

```ts
transition("review", "refine", { on: "changesRequested", when: (c: Context) => c.attempts < 3 }),
transition("review", "triage", { on: "changesRequested" }),
```

Semantics: transitions are evaluated in declaration order and the first whose outcome matches and whose guard passes wins; guards see the context **after** the actor's `update` has been folded in; guards must be pure and synchronous. If an outcome matches transitions but every guard refuses, the run rejects loudly rather than stalling.

## Current limits

- The XState compiler is the only runtime compiler.
- The event stream (plus the CLI's `--record`) is the run record; richer aggregation over recorded runs is not implemented.
- A machine cannot yet invoke another machine (or itself) as a task.

See the [software factory example](../../examples/software-factory) for the full blueprint and the [Veyor README](../../README.md) for the project overview.
