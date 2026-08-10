import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { handle } from "./foo.handler.ts";

describe("foo handler", () => {
  it.effect("uppercases text", () =>
    Effect.gen(function* () {
      expect(yield* handle("panorama")).toBe("PANORAMA");
    })
  );
});
