import { actor } from "@veyorhq/core";
import { expect, test } from "vitest";
// oxlint-disable-next-line typescript/ban-ts-comment -- only errors under the node project, so expect-error is unusable
// @ts-ignore -- source is type-checked by the referenced app project
import { agent, type ModelLayer } from "../src/index.ts";

function plainSchema<A>() {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stand-in schema
      validate: (value: unknown) => ({ value: value as A }),
      jsonSchema: { input: () => ({}), output: () => ({}) },
    },
  };
}

const Empty = plainSchema<{}>();
const Worker = actor("worker", {
  context: plainSchema<{ objective: string }>(),
  input: Empty,
  output: plainSchema<{ outcome: "completed" }>(),
  aggregate: Empty,
});

test("rejects a model worker whose output contract cannot be supplied to Effect AI", () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the layer is never used; the throw happens first
  expect(() => agent(Worker, {} as ModelLayer)).toThrow("You must use effect schemas");
});
