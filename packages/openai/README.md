# `@veyorhq/openai`

`@veyorhq/openai` provides OpenAI-backed implementations for Veyor actors.

It exposes two separate adapters:

- `@veyorhq/openai/openai` creates an Effect AI model layer for `@veyorhq/ai-effect`.
- `@veyorhq/openai/codex` runs a Veyor actor through the local Codex CLI.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

## OpenAI API

Use `openai(model)` with `agent(...)` when the actor should call the OpenAI API through Effect AI.

```ts
import { agent } from "@veyorhq/ai-effect";
import { openai } from "@veyorhq/openai/openai";
import { Writer } from "./actors.js";

const WriterImpl = agent(Writer, openai("gpt-4o-mini"), {
  prompt: "Return a concise implementation plan.",
});
```

The adapter reads `OPENAI_API_KEY` through Effect `Config`. Missing or invalid configuration fails when the model layer is used.

## Codex CLI

Use `codex(actor, model, options)` when a Codex task should implement the actor.

```ts
import { codex } from "@veyorhq/openai/codex";
import { Planner } from "./actors.js";

const PlannerImpl = codex(Planner, "gpt-5.6-sol", {
  effort: "xhigh",
  cwd: process.cwd(),
  sandbox: "workspace-write",
  instructions: "Plan the assignment. Do not edit files.",
});
```

The adapter:

1. converts the actor output contract to JSON Schema;
2. writes that schema to a scoped temporary directory;
3. runs `codex exec` with structured output enabled;
4. parses and validates the final JSON value;
5. passes the Veyor task's abort signal into the Effect runtime.

### Options

| Option         | Purpose                                                             |
| -------------- | ------------------------------------------------------------------- |
| `effort`       | Sets Codex model reasoning effort.                                  |
| `verbosity`    | Sets model verbosity.                                               |
| `instructions` | Adds package- or actor-specific instructions before the assignment. |
| `cwd`          | Sets the Codex working directory.                                   |
| `sandbox`      | Selects `read-only`, `workspace-write`, or `danger-full-access`.    |

The Codex executable must be installed, authenticated, and available on `PATH`. The adapter defaults to the `workspace-write` sandbox; choose a narrower sandbox when the actor does not need writes.

## Current limits

- Both adapters require output contracts that can produce JSON Schema.
- Codex aggregation currently returns an empty placeholder.
- The OpenAI model adapter inherits the unfinished aggregation support from `@veyorhq/ai-effect`.
- Retry, fallback, and budget policy belong to the workflow and are not added by this package.

See [`@veyorhq/ai-effect`](../ai-effect), [`@veyorhq/core`](../core), and the [software factory example](../../examples/software-factory).
