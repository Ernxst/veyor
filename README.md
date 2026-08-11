# Veyor

Veyor is a TypeScript library for describing software factories as typed workflow blueprints with replaceable workers.

A Veyor blueprint describes the work: its context, tasks, transitions, actors, and runtime contracts. An assembly supplies the workers. The same blueprint can use deterministic functions, terminal prompts, AI models, Codex agents, or probabilistic stand-ins without changing the workflow itself.

That split is Veyor's core idea: design the factory before choosing the cost, capability, and autonomy of its workers.

> [!IMPORTANT]
> Veyor is under active development. Its packages are private and remain at `0.0.0`; they are not ready to install from a package registry. The core model, actor adapters, runner, and `veyor` CLI exist and run end to end, but history and aggregation are not implemented. Treat the repository as a working library, not a production release.

## Why Veyor?

Suppose you want multi-step work — delivering software, most concretely — done by some mix of AI models, ordinary code, and people. The common approach is to hand the whole job to one AI agent in a loop and steer it with prompts. That works until you care about three things at once: **process** (nothing forces the agent to review before shipping — quality lives in a prompt it may ignore), **cost** (you learn what a run costs by paying for it, and an agent deciding its own next step spends expensive judgment on decisions that need none), and **predictability** (you cannot test the workflow without running the workers).

Veyor separates the process from the workers. You describe the workflow once — its steps, the allowed paths between them, and the exact shape of every input and output — as a typed **blueprint**. Then you **assemble** it by plugging a worker into each role: a plain function, an AI model, a coding agent in a terminal, a person, or a simulator. The blueprint enforces the process; the workers are interchangeable; the type system checks that nothing is missing before anything runs.

That separation is the whole idea, and it pays twice:

1. **The role contract is the unit of substitution.** A blueprint names capabilities with typed context, input, and output schemas — never workers. The same role can be filled by deterministic code, a human at a terminal, an Anthropic or OpenAI model, a Claude Code, Codex, or opencode CLI session, or a seeded simulator, chosen per assembly without touching the workflow. Swap a reviewer from one vendor to another, or from a model to a person, and the process does not change.
2. **Simulation is a first-class assembly, not a mock.** Because outputs are schema-typed and routing is outcome-driven, seeded probabilistic workers can generate contract-valid outputs — including realistic correlated failure like rejection streaks — and drive the real machine through its real transitions. You can Monte Carlo a workflow's outcome distribution and spend profile ten thousand times before paying for a single model call or human hour.

The supporting choices serve those two ideas:

- **Blueprints own control flow.** Tasks and transitions form a typed state machine, currently compiled to XState.
- **Assemblies own execution choices.** A blueprint is complete only when every actor has an implementation, checked at compile time.
- **Schemas stay at the boundary.** Standard Schema contracts, with adapters for Effect Schema, TypeBox, and Valibot, validated at runtime.

The result is a factory-first library: the durable artifact is the workflow and its contracts, not a prompt, provider, terminal layout, or one agent loop.

**If you already know the landscape:** typed, state-machine-constrained agents are not new — [`statelyai/agent`](https://github.com/statelyai/agent) established the idea of a machine owning an agent's control flow, and Veyor borrows it openly. Veyor's own claim is the two points above: replaceable workers behind typed contracts, and simulation as an assembly. If you only need a model constrained by a state machine, use Stately Agent; Veyor earns its place when you need the same workflow to survive changes in who — or what — does the work.

## Core model

| Concept      | Purpose                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `actor`      | Names a capability and defines its context, input, output, and aggregate contracts.                 |
| `task`       | Assigns one or more actors to a step in the workflow.                                               |
| `assign`     | Attaches an actor to a task, optionally behind a routing condition.                                 |
| `transition` | Defines the allowed path between tasks.                                                             |
| `machine`    | Combines context, tasks, and transitions into a reusable blueprint.                                 |
| `assemble`   | Binds every actor in a blueprint to a concrete implementation and creates a factory implementation. |

Every actor output must contain an `outcome: string`. Define `outcome` with a literal or literal union in the output schema so Veyor can constrain each task's transitions to the outcomes its actors declare.

## Implementation status

Implemented today:

- typed actors, tasks, transitions, machines, and complete assembly checks;
- deterministic, probabilistic, and terminal-prompt actor implementations;
- Effect AI, Anthropic, OpenAI, Claude Code, Codex, and opencode adapters;
- Standard Schema adapters and actor-output validation;
- an XState compiler with task input derivation, actor-output updates to machine context, context-aware selection between several assignments, and guarded transitions that route on outcome plus context;
- per-task retries with re-selection, so repeated failure can escalate to a more capable actor;
- `Factory.run(...)` validating the initial context, streaming progress events to an observer, and resolving with the final sink and context;
- seeded, reproducible simulation, including outcome weights derived from live context (see the [software factory example](./examples/software-factory) and `veyor simulate`);
- the [`veyor` CLI](./packages/cli): a project declares its command-line surface in `veyor.config.ts`, and `veyor run`, `veyor simulate`, and `veyor inspect` derive flag types from the context schema and decode all input through it.

Not implemented:

- run history, aggregation, and richer retry metadata;
- a machine invoking another machine (or itself) as a task.

## Example

This small factory has one typed actor and one deterministic implementation:

```ts
import { actor, assemble, assign, machine, sink, task, transition } from "@veyor/core";
import { deterministic } from "@veyor/core/actors";
import { schema } from "@veyor/core/schema/effect";
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

For the full design, see the [software factory example](./examples/software-factory). It assembles one blueprint in two ways:

- a low-cost probabilistic factory for exercising routes and outcomes;
- an LLM factory that mixes Codex workers, deterministic policy, and human approval.

## Packages

| Package                                    | Role                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| [`@veyor/core`](./packages/core)           | Workflow model, XState compiler, actor implementations, and schema adapters.  |
| [`@veyor/ai-effect`](./packages/ai-effect) | Effect AI language models as Veyor actors.                                    |
| [`@veyor/anthropic`](./packages/anthropic) | Anthropic API and Claude Code CLI implementations for Veyor actors.           |
| [`@veyor/openai`](./packages/openai)       | OpenAI API and Codex CLI implementations for Veyor actors.                    |
| [`@veyor/opencode`](./packages/opencode)   | opencode CLI implementations for Veyor actors, including its free model tier. |

[`@veyor/cli`](./packages/cli) hosts factories at the command line: `veyor run`, `veyor simulate`, and `veyor inspect` over a project's `veyor.config.ts`.

## Prior work

Veyor builds on two projects that solve adjacent parts of the same problem:

- [`swarm-forge`](https://github.com/unclebob/swarm-forge/tree/squad) is a local, tmux-based orchestration system. It contributes the software-factory framing: named roles, separate worktrees, explicit handoffs, project-level rules, and observable multi-agent work. Veyor moves that topology into an embeddable, typed library and adds contract-driven simulation.
- [`statelyai/agent`](https://github.com/statelyai/agent) makes an XState machine own an LLM agent's control flow while the model can choose only legal events. Veyor keeps that state-machine discipline, then makes the worker behind each typed actor replaceable. A worker can be a model, a human, deterministic code, or a simulator.

In short, SwarmForge orchestrates agent terminals and Stately Agent constrains model-driven agents. Veyor defines portable software factories whose workflow can be assembled, simulated, and run with different kinds of workers.

## Development

This is a Bun monorepo. The repository pins the supported Bun and Node.js versions.

```sh
bun install --frozen-lockfile
bun run check
bun run test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.
