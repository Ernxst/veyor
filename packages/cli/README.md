# `@veyorhq/cli`

`@veyorhq/cli` is the runtime host for Veyor factories: it takes a project's assembled factory and gives it an execution environment — input handling, progress rendering, results, exit codes, and simulation. Blueprints, assemblies, and policy stay in TypeScript; the CLI never defines them.

> [!NOTE]
> The CLI runs under Bun or Node ≥ 23.6: `veyor.config.ts` is imported directly by the host runtime, which needs native TypeScript support (Node strips erasable type syntax natively from 23.6). On older Node, write the config as `veyor.config.js`.

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
veyor run [args] [--assembly <name>] [--context base.json] [--seed n] [--json] [--quiet] [--record path] [--resume path]
veyor simulate [args] [--runs n] [--seed n]
veyor inspect [--mermaid]
```

- **run** assembles the initial context, runs the factory with a progress observer on stderr (`--json` switches to NDJSON events for embedders, one line per event with an `at` epoch-ms timestamp), prints `{ task, context }` as JSON on stdout, and exits nonzero when the sink is not in `run.success`. Text mode brackets the run with a header (`▶ <machine id> · assembly <name>[ · seed <n>]`) and footer (`■ <sink> in <duration>`) line, and — outside `--json` — prints a status line if the run goes 60s without an event, repeating every further 60s of silence, so a long-running worker doesn't look hung.
  - `--quiet` hides worker activity narration (tool runs, edits, text, usage) and shows only station-level events (`invoke`, `complete`, `transition`, `retry`, `error`).
  - `--record <path>` writes the run as a crash-safe NDJSON record: a header line with the machine id and the decoded initial context, then one timestamped event per line, appended synchronously as the run progresses — so a killed process still leaves a usable record up to the last completed step.
  - `--resume <path>` resumes a run from a record written by `--record`: the initial context comes from the header, events up to where the record ends are replayed (no workers re-invoked), and the run goes live from there. Combine with a fresh `--record` to leave a standalone record of the resumed run.
- **simulate** runs the factory `--runs` times (run _i_ seeds a seeded assembly with `seed + i`) and prints a sink/failure tally, plus a `context` block of `{ mean, min, max }` for every numeric field in the context schema, aggregated across successful runs (e.g. `context: { spend: { mean, min, max }, ... }`). It defaults to the config's sole seed-parameterized assembly — never `run.assembly`, which could fire real workers.
- **inspect** prints the blueprint — stations, actors, transitions — as text or a Mermaid state diagram.

See the [software factory example](../../examples/software-factory) for a complete config and the [Veyor README](../../README.md) for the library this hosts.
