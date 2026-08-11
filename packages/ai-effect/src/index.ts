import type { Actor } from "@veyor/core";
import { isEffectSchema } from "@veyor/core/schema/effect";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { LanguageModel, type Model } from "effect/unstable/ai";

export interface AgentOptions {
  readonly prompt?: string;
}

export type ModelLayer = Layer.Layer<
  LanguageModel.LanguageModel | Model.ProviderName,
  never,
  never
>;

export function agent<A extends Actor.Any>(
  actor: A,
  model: ModelLayer,
  options: AgentOptions = {}
): Actor.ImplementationOf<A> {
  const output = actor.contract.Output;
  if (!isEffectSchema(output)) throw new Error("You must use effect schemas");

  return {
    ...actor,
    run: ({ input, signal }) =>
      Effect.runPromise(
        LanguageModel.generateObject({
          objectName: actor.name,
          prompt: [options.prompt, JSON.stringify(input)].filter(Boolean).join("\n\n"),
          schema: output,
        }).pipe(
          Effect.map((response) => response.value),
          Effect.provide(model)
        ),
        { signal }
      ),

    aggregate: () => {
      throw new Error("Not implemented");
    },
  };
}
