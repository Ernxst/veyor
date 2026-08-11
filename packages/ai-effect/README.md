# `@veyorhq/ai-effect`

`@veyorhq/ai-effect` turns an Effect AI language model into a Veyor actor implementation.

It is the bridge between a provider-neutral Veyor actor contract and Effect's `LanguageModel.generateObject` API. The model receives the actor input and must return a value that matches the actor's Effect Schema output.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

## Usage

```ts
import { agent } from "@veyorhq/ai-effect";
import { assemble } from "@veyorhq/core";
import { openai } from "@veyorhq/openai/openai";
import { Blueprint, Writer } from "./blueprint.js";

const Factory = assemble(
  Blueprint,
  agent(Writer, openai("gpt-4o-mini"), {
    prompt: "Write a concise implementation plan.",
  })
);
```

`agent` accepts:

- a Veyor actor;
- a model layer, such as the one returned by `openai(...)`;
- an optional prompt placed before the serialized actor input.

The returned implementation can be passed directly to `assemble`.

## Output contracts

The actor's output must use the Effect Schema adapter from `@veyorhq/core/schema/effect`.

```ts
import { actor } from "@veyorhq/core";
import { schema } from "@veyorhq/core/schema/effect";
import * as Schema from "effect/Schema";

const Writer = actor("writer", {
  input: schema(Schema.Struct({ objective: Schema.String })),
  output: schema(Schema.Struct({ plan: Schema.String })),
});
```

Other Standard Schema adapters are valid in `@veyorhq/core`, but this package currently rejects non-Effect output schemas.

## Providers

`@veyorhq/ai-effect` does not choose a provider. Supply any compatible Effect AI model layer. Veyor's OpenAI integration is available through [`@veyorhq/openai`](../openai).

## Current limits

- Actor aggregation is not implemented and throws if called.
- The current XState compiler does not populate task input, so assembled AI actors receive `undefined` until input propagation is implemented.
- The adapter starts an Effect runtime at the Veyor actor boundary because the core actor contract is promise-based.
- Provider failures remain visible to the caller; this package does not add retries or fallback models.

See [`@veyorhq/core`](../core) for actor and machine definitions, or the [Veyor README](../../README.md) for the project overview.
