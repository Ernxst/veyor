import * as Schema from "effect/Schema";
import { assertType, expectTypeOf, test } from "vitest";
import { deterministic } from "../actors/deterministic.ts";
import { actor, assemble, assign, machine, task } from "../index.ts";
import { schema } from "../lib/schema/effect.ts";

const Context = schema(Schema.Struct({}));
const Aggregate = schema(Schema.Struct({ count: Schema.Finite }));

const First = actor("first", {
  input: schema(Schema.Struct({})),
  output: schema(Schema.Struct({ first: Schema.String, outcome: Schema.String })),
  aggregate: Aggregate,
  context: Context,
});

const Second = actor("second", {
  input: schema(Schema.Struct({})),
  output: schema(Schema.Struct({ second: Schema.String, outcome: Schema.String })),
  aggregate: Aggregate,
  context: Context,
});

const Blueprint = machine({
  id: "assemble-type-contract",
  initial: "work",
  context: Context,
  tasks: [task("work", assign(First), assign(Second))],
  transitions: [],
});

test("assembles implementations in any order", () => {
  const assembled = assemble(
    Blueprint,
    deterministic(Second, () => ({ second: "ok", outcome: "foo" })),
    deterministic(First, () => ({ first: "ok", outcome: "bar" }))
  );

  expectTypeOf(assembled.def).toEqualTypeOf<typeof Blueprint>();
});

assertType(
  assemble(
    Blueprint,
    // @ts-expect-error -- assembly must provide an implementation for every blueprint actor.
    deterministic(First, () => ({ first: "ok" }))
  )
);
