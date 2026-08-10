import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { barCommand } from "./bar.command.js";

describe("bar command", () => {
  it.effect("prints reversed text", () =>
    Effect.gen(function* () {
      const output = yield* Effect.gen(function* () {
        yield* Command.runWith(barCommand, { version: "0.0.1" })(["panorama"]);
        return yield* TestConsole.logLines;
      }).pipe(Effect.provide(Layer.merge(NodeServices.layer, TestConsole.layer)));

      expect(output).toStrictEqual(["amaronap"]);
    })
  );
});
