import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import type { ModelLayer } from "@forge/ai-effect";
import * as Config from "effect/Config";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/unstable/http";

const AnthropicClientLive = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie);

export function anthropic(m: AnthropicLanguageModel.Model): ModelLayer {
  return AnthropicLanguageModel.model(m).pipe(Layer.provide(AnthropicClientLive));
}
