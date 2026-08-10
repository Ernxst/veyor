# `@forge/core`

`@forge/core` is the workflow model behind Forge. It defines typed actors, tasks, transitions, and machines, then binds them to concrete workers with `assemble`.

Use this package when you want the workflow to survive changes in model, provider, human role, or execution strategy.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

## How it fits

A Forge application has two parts:

1. A **blueprint** declares the workflow and its contracts.
2. An **assembly** supplies one implementation for every actor in that blueprint.

The blueprint is the durable part. You can assemble it with deterministic code, human prompts, AI adapters, or probabilistic stand-ins without changing its tasks and transitions.

## Example

```ts
import { actor, assemble, assign, machine, sink, task, transition } from "@forge/core";
import { deterministic } from "@forge/core/actors";
import { schema } from "@forge/core/schema/effect";
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
  aggregate: Empty,
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

Every actor output must contain an `outcome: string`. Define `outcome` with a literal or literal union in the output schema so Forge can constrain each task's transitions to the outcomes its actors declare.

## Public entry points

| Entry point                  | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `@forge/core`                | `actor`, `task`, `sink`, `assign`, `transition`, `machine`, and `assemble`. |
| `@forge/core/actors`         | Deterministic, probabilistic, and terminal-prompt actor implementations.    |
| `@forge/core/schema`         | Standard Schema and JSON Schema helpers.                                    |
| `@forge/core/schema/effect`  | Effect Schema adapter and JSON encoding helpers.                            |
| `@forge/core/schema/typebox` | TypeBox adapter.                                                            |
| `@forge/core/schema/valibot` | Valibot adapter.                                                            |

## Actor implementations

### Deterministic

Use `deterministic` for ordinary synchronous or promise-based TypeScript. Forge validates the returned value against the actor's output contract.

```ts
const PlannerImpl = deterministic(Planner, ({ context }) => ({
  outcome: "planned",
  summary: `Plan: ${context.objective}`,
}));
```

### Probabilistic

Use `probabilistic` to exercise a workflow without paying for real workers. It can generate values from an actor's JSON Schema, fail at a configured rate, choose weighted outcomes, and replay seeded runs.

```ts
import { probabilistic } from "@forge/core/actors";

const PlannerSimulation = probabilistic(Planner, {
  seed: 42,
  failureRate: 0.05,
});
```

### Human prompt

Use `prompt` for a terminal-owned authority boundary. The package includes `question()` and `review()` formats.

```ts
import { prompt, question } from "@forge/core/actors";

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

Actor inputs and outputs use the Standard Schema contract. Forge includes adapters for:

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

## Transitions

`transition(from, to, { on, when? })` routes on the actor's declared `outcome`, and optionally on context. Guarded transitions let policy live on edges instead of dedicated policy tasks — a budget gate or a bounded retry loop is a guard plus an unguarded fallback:

```ts
transition("review", "refine", { on: "changesRequested", when: (c: Context) => c.attempts < 3 }),
transition("review", "triage", { on: "changesRequested" }),
```

Semantics: transitions are evaluated in declaration order and the first whose outcome matches and whose guard passes wins; guards see the context **after** the actor's `update` has been folded in; guards must be pure and synchronous. If an outcome matches transitions but every guard refuses, the run rejects loudly rather than stalling.

## Current limits

- The XState compiler is the only runtime compiler.
- Run history, aggregation, and richer retry metadata are not implemented.
- A machine cannot yet invoke another machine (or itself) as a task.

See the [software factory example](../../examples/software-factory) for the full blueprint and the [Forge README](../../README.md) for the project overview.
