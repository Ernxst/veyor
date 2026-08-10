# `@forge/ai-effect`

`@forge/ai-effect` turns an Effect AI language model into a Forge actor implementation.

It is the bridge between a provider-neutral Forge actor contract and Effect's `LanguageModel.generateObject` API. The model receives the actor input and must return a value that matches the actor's Effect Schema output.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

## Usage

```ts
import { agent } from "@forge/ai-effect";
import { assemble } from "@forge/core";
import { openai } from "@forge/openai/openai";
import { Blueprint, Writer } from "./blueprint.js";

const Factory = assemble(
  Blueprint,
  agent(Writer, openai("gpt-4o-mini"), {
    prompt: "Write a concise implementation plan.",
  })
);
```

`agent` accepts:

- a Forge actor;
- a model layer, such as the one returned by `openai(...)`;
- an optional prompt placed before the serialized actor input.

The returned implementation can be passed directly to `assemble`.

## Output contracts

The actor's output must use the Effect Schema adapter from `@forge/core/schema/effect`.

```ts
import { actor } from "@forge/core";
import { schema } from "@forge/core/schema/effect";
import * as Schema from "effect/Schema";

const Writer = actor("writer", {
  input: schema(Schema.Struct({ objective: Schema.String })),
  output: schema(Schema.Struct({ plan: Schema.String })),
  aggregate: schema(Schema.Struct({})),
});
```

Other Standard Schema adapters are valid in `@forge/core`, but this package currently rejects non-Effect output schemas.

## Providers

`@forge/ai-effect` does not choose a provider. Supply any compatible Effect AI model layer. Forge's OpenAI integration is available through [`@forge/openai`](../openai).

## Current limits

- Actor aggregation is not implemented and throws if called.
- The current XState compiler does not populate task input, so assembled AI actors receive `undefined` until input propagation is implemented.
- The adapter starts an Effect runtime at the Forge actor boundary because the core actor contract is promise-based.
- Provider failures remain visible to the caller; this package does not add retries or fallback models.

See [`@forge/core`](../core) for actor and machine definitions, or the [Forge README](../../README.md) for the project overview.
