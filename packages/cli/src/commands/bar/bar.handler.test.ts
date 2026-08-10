import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { handle } from "./bar.handler.ts";

describe("bar handler", () => {
  it.effect("reverses text", () =>
    Effect.gen(function* () {
      expect(yield* handle("panorama")).toBe("amaronap");
    })
  );
});
