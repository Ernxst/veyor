import { actor, assemble, assign, machine, sink, task, transition } from "@veyor/core";
import { deterministic } from "@veyor/core/actors";
import { schema } from "@veyor/core/schema/effect";
import * as Schema from "effect/Schema";
import { assertType, test } from "vitest";
import { defineConfig } from "./config.ts";

const Context = schema(
  Schema.Struct({
    input: Schema.Struct({ task: Schema.String }),
    budget: Schema.Finite,
  })
);

const Empty = schema(Schema.Struct({}));

const Worker = actor("worker", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literal("shipped") })),
  aggregate: Empty,
});

const Blueprint = machine({
  id: "typed-config",
  initial: "work",
  context: Context,
  tasks: [task("work", assign(Worker)), sink("done")],
  transitions: [transition("work", "done", { on: "shipped" })],
});

const factory = assemble(
  Blueprint,
  deterministic(Worker, () => ({ outcome: "shipped" as const }))
);

test("accepts a fully inferred config", () => {
  assertType(
    defineConfig({
      assemblies: { main: factory, seeded: (_seed: number) => factory },
      args: [
        { key: "input.task", position: 0 },
        { key: "budget", name: "b" },
      ],
      run: { assembly: "main", success: "done" },
    })
  );
});

test("rejects an assembly name not in the assemblies record", () => {
  assertType(
    defineConfig({
      assemblies: { main: factory },
      // @ts-expect-error -- "missing" is not a declared assembly.
      run: { assembly: "missing" },
    })
  );
});

test("rejects a success sink the machine does not rest at", () => {
  assertType(
    defineConfig({
      assemblies: { main: factory },
      // @ts-expect-error -- "work" is a station, not a sink.
      run: { success: "work" },
    })
  );
});

test("rejects a key that is not a context path", () => {
  assertType(
    defineConfig({
      assemblies: { main: factory },
      // @ts-expect-error -- "nope" is not a path into the context.
      args: [{ key: "nope" }],
    })
  );
});

test("rejects an arg that is both named and positional", () => {
  assertType(
    defineConfig({
      assemblies: { main: factory },
      // @ts-expect-error -- name and position are mutually exclusive.
      args: [{ key: "budget", name: "b", position: 0 }],
    })
  );
});
