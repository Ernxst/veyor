# `@veyorhq/cli`

`@veyorhq/cli` is the runtime host for Veyor factories: it takes a project's assembled factory and gives it an execution environment — input handling, progress rendering, results, exit codes, and simulation. Blueprints, assemblies, and policy stay in TypeScript; the CLI never defines them.

> [!NOTE]
> The CLI targets Bun: `veyor.config.ts` is imported directly by the host runtime.

## The contract

A project exposes itself to the CLI with a `veyor.config.ts` in its root:

```ts
import { defineConfig } from "@veyorhq/cli";
import headless from "./src/factories/headless.ts";
import llm from "./src/factories/llm.ts";

export default defineConfig({
  name: "software-factory",
  description: "Deliver a task through a verified assembly line",
  assemblies: { llm, headless },
  args: [
    { key: "input.prompt", position: 0, description: "What to deliver" },
    { key: "spendBudget", name: "budget", description: "Model-grade call budget" },
    { key: "backlog", from: "file", description: "Caller-supplied decomposition" },
  ],
  run: { assembly: "llm", success: "done" },
  examples: [{ command: 'veyor run "Ship dark mode" --budget 25' }],
});
```

An arg spec is purely presentational — where the value lands (`key`, a dot path into the machine's context), how it reads on the command line (a `name`d flag or a `position`al, never both), and its provenance (`from: "file"` loads the value from the file the user names). The config is fully inferred: `key` paths, `run.assembly`, and `run.success` sinks are literal types read off the assemblies record, so a typo is a compile error in `veyor.config.ts`.

**Types come from the context schema, never from the config**: the CLI reads each arg's primitive type out of the machine's JSON Schema, parses argv accordingly, deep-merges the values (over an optional `--context base.json`), and decodes the result through the context schema — so schema defaults fill every field the caller doesn't supply, and validation errors are reported against the flag the user typed.

This requires the machine's context schema to be JSON-Schema-capable. Natively Standard-Schema-compatible libraries (valibot, typebox) can be passed to `machine()` raw — they are upgraded on construction; Effect schemas come through `schema()` from `@veyorhq/core/schema/effect`.

## Project structure

One prescribed shape. The dependency spine of a factory — contracts, then roles over the contracts, then the blueprint over the roles, then assemblies binding workers to roles, then the CLI surface — **is** the file layout, one concept per place:

```
veyor.config.ts        # the CLI surface — the only file veyor reads
src/
  schema.ts            # contracts: the context and every station's input/output
  actors.ts            # roles: named capabilities over those contracts
  blueprint.ts         # the machine: stations, routing, guards, policy constants
  assemblies/
    policy.ts          # deterministic workers shared across assemblies (named exports)
    llm.ts             # one file per assembly; default export = assemble(blueprint, ...workers)
    headless.ts
    probabilistic.ts   # the seeded simulation assembly
```

Each file imports only from the files above it; if an import points the other way, something is in the wrong place. `schema.ts` is the whole model — contracts _and_ the pure operations over them (the example's backlog queries live there, not in a helpers file). Growth is by splitting in place, not by new top-level concepts: a large `schema.ts` becomes `src/schema/` with one file per station, a large `actors.ts` splits the same way — the spine does not change.

In a **monorepo**, the factory is a workspace package — conventionally `factory/` at the repo root, with exactly the shape above inside it and the `@veyorhq/*` and worker-adapter dependencies in its own `package.json`. `veyor` reads `veyor.config.ts` from the working directory, so runs happen in that package; give the root a forwarding script if you want to drive it from anywhere:

```jsonc
// root package.json
"scripts": { "factory": "bun run --cwd factory veyor" }
```

A factory that delivers the repository it lives in confines its workers to the repo root (the worker adapters take a directory), while the config, blueprint, and prompts stay isolated in `factory/` — the factory is tooling _about_ the repo, not part of its product surface.

## Commands

```sh
veyor run [args] [--assembly <name>] [--context base.json] [--seed n] [--json]
veyor simulate [args] [--runs n] [--seed n]
veyor inspect [--mermaid]
```

- **run** assembles the initial context, runs the factory with a progress observer on stderr (`--json` switches to NDJSON events for embedders), prints `{ task, context }` as JSON on stdout, and exits nonzero when the sink is not in `run.success`.
- **simulate** runs the factory `--runs` times (run _i_ seeds a seeded assembly with `seed + i`) and prints a sink/failure tally. It defaults to the config's sole seed-parameterized assembly — never `run.assembly`, which could fire real workers.
- **inspect** prints the blueprint — stations, actors, transitions — as text or a Mermaid state diagram.

See the [software factory example](../../examples/software-factory) for a complete config and the [Veyor README](../../README.md) for the library this hosts.
