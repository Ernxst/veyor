# `@forge/cli`

`@forge/cli` is the runtime host for Forge factories: it takes a project's assembled factory and gives it an execution environment — input handling, progress rendering, results, exit codes, and simulation. Blueprints, assemblies, and policy stay in TypeScript; the CLI never defines them.

> [!NOTE]
> The CLI targets Bun: `forge.config.ts` is imported directly by the host runtime.

## The contract

A project exposes itself to the CLI with a `forge.config.ts` in its root:

```ts
import { defineConfig } from "@forge/cli";
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
  examples: [{ command: 'forge run "Ship dark mode" --budget 25' }],
});
```

An arg spec is purely presentational — where the value lands (`key`, a dot path into the machine's context), how it reads on the command line (a `name`d flag or a `position`al, never both), and its provenance (`from: "file"` loads the value from the file the user names). The config is fully inferred: `key` paths, `run.assembly`, and `run.success` sinks are literal types read off the assemblies record, so a typo is a compile error in `forge.config.ts`.

**Types come from the context schema, never from the config**: the CLI reads each arg's primitive type out of the machine's JSON Schema, parses argv accordingly, deep-merges the values (over an optional `--context base.json`), and decodes the result through the context schema — so schema defaults fill every field the caller doesn't supply, and validation errors are reported against the flag the user typed.

This requires the machine's context schema to be JSON-Schema-capable. Natively Standard-Schema-compatible libraries (valibot, typebox) can be passed to `machine()` raw — they are upgraded on construction; Effect schemas come through `schema()` from `@forge/core/schema/effect`.

## Commands

```sh
forge run [args] [--assembly <name>] [--context base.json] [--seed n] [--json]
forge simulate [args] [--runs n] [--seed n]
forge inspect [--mermaid]
```

- **run** assembles the initial context, runs the factory with a progress observer on stderr (`--json` switches to NDJSON events for embedders), prints `{ task, context }` as JSON on stdout, and exits nonzero when the sink is not in `run.success`.
- **simulate** runs the factory `--runs` times (run _i_ seeds a seeded assembly with `seed + i`) and prints a sink/failure tally. It defaults to the config's sole seed-parameterized assembly — never `run.assembly`, which could fire real workers.
- **inspect** prints the blueprint — stations, actors, transitions — as text or a Mermaid state diagram.

See the [software factory example](../../examples/software-factory) for a complete config and the [Forge README](../../README.md) for the library this hosts.
