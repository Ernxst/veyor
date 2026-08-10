# Software factory example

This example models a multi-stage software factory with Forge. It is the broadest statement of the library's intended shape: one typed workflow, assembled with different kinds of workers.

> [!IMPORTANT]
> The probabilistic assembly runs end to end — see the Monte Carlo script below. The LLM assembly type-checks against the same blueprint but shells out to the Codex CLI, and `forge run` is not implemented.

## What it models

The blueprint in [`src/machine.ts`](./src/machine.ts) includes:

- planning and dispatch;
- implementation, review, QA, and refinement;
- different workers for different complexity and risk;
- stall and spend circuit breakers;
- triage and recovery paths;
- explicit user questions and review;
- `done` and `abandoned` terminal tasks.

Actor contracts live in [`src/actors.ts`](./src/actors.ts). Shared Effect Schemas live in [`src/schema.ts`](./src/schema.ts).

## One blueprint, two assemblies

The example keeps workflow design separate from worker choice.

### Probabilistic assembly

[`src/factories/probabilistic.ts`](./src/factories/probabilistic.ts) replaces expensive or unavailable workers with generated outcomes and configured failure rates. Reviews model correlated failure — each consecutive rejection raises the odds of another — so the stall detector observes realistic streaks. Deterministic code in [`src/factories/policy.ts`](./src/factories/policy.ts) owns the spend gate and stall policy for both assemblies.

Run the Monte Carlo script to sample the blueprint's routes without a single model call:

```sh
bun scripts/probabilistic.ts
```

It runs 500 seeded, reproducible simulations and prints the terminal-outcome distribution and mean spend.

### LLM assembly

[`src/factories/llm.ts`](./src/factories/llm.ts) assigns Codex models to planning, dispatch, implementation, verification, refinement, and triage, and Claude Code to review — independent evaluation deliberately runs on a different vendor than the implementers so it does not share their blind spots. Deterministic code keeps the spend boundary, while terminal prompts keep user-owned decisions with the user.

Both implementations satisfy the same actor contracts and assemble the same `MySoftwareFactoryBlueprint`.

## Type-check the example

From the repository root:

```sh
./node_modules/.bin/tsc -b examples/software-factory/tsconfig.json --noEmit
```

## Read the example

Start in this order:

1. [`src/schema.ts`](./src/schema.ts) — shared domain and boundary contracts.
2. [`src/actors.ts`](./src/actors.ts) — named capabilities and their typed inputs and outputs.
3. [`src/machine.ts`](./src/machine.ts) — tasks, assignment policies, and allowed transitions.
4. [`src/factories/probabilistic.ts`](./src/factories/probabilistic.ts) — low-cost simulation assembly.
5. [`src/factories/llm.ts`](./src/factories/llm.ts) — Codex, deterministic, and human implementations.

See the [`@forge/core` README](../../packages/core) for the library model and the [Forge README](../../README.md) for the project overview and prior work.
