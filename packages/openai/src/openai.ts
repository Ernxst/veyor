import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import type { ModelLayer } from "@veyor/ai-effect";
import * as Config from "effect/Config";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/unstable/http";

const OpenAiClientLive = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie);

export function openai(m: OpenAiLanguageModel.Model): ModelLayer {
  return OpenAiLanguageModel.model(m).pipe(Layer.provide(OpenAiClientLive));
}
