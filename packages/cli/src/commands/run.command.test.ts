import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { actor, assemble, assign, machine, sink, task, transition } from "@forge/core";
import { deterministic } from "@forge/core/actors";
import { schema } from "@forge/core/schema/effect";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { defineConfig } from "../config.ts";
import { makeInspect } from "./inspect.ts";
import { makeRun } from "./run.ts";
import { makeSimulate } from "./simulate.ts";

const Context = schema(
  Schema.Struct({
    input: Schema.Struct({ task: Schema.String }),
    budget: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(1))),
    attempts: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
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
  id: "test-factory",
  initial: "work",
  context: Context,
  tasks: [task("work", assign(Worker)), sink("done")],
  transitions: [transition("work", "done", { on: "shipped" })],
});

const factory = assemble(
  Blueprint,
  deterministic(Worker, () => ({ outcome: "shipped" as const }))
);

const config = defineConfig({
  assemblies: { test: factory },
  args: [
    { key: "input.task", position: 0, description: "What to deliver" },
    { key: "budget", description: "Spend ceiling" },
  ],
  run: { success: "done" },
});

const services = Layer.merge(NodeServices.layer, TestConsole.layer);

const readConsole = Effect.gen(function* () {
  const out = yield* TestConsole.logLines;
  const err = yield* TestConsole.errorLines;
  return { out: out.map(String), err: err.map(String) };
});

const exec = <E, R>(effect: Effect.Effect<void, E, R>) =>
  effect.pipe(
    Effect.flatMap(() => readConsole),
    Effect.provide(services)
  );

const parsed = (lines: readonly string[]): unknown => JSON.parse(lines.join("\n"));

const version = { version: "0.0.0" };

describe("forge run", () => {
  it.effect("lifts args by schema kind, applies defaults, and reports the sink", () =>
    Effect.gen(function* () {
      const { out } = yield* exec(
        Command.runWith(makeRun(config), version)(["ship it", "--budget", "5"])
      );

      expect(parsed(out)).toStrictEqual({
        task: "done",
        context: { input: { task: "ship it" }, budget: 5, attempts: 0 },
      });
    })
  );

  it.effect("maps schema issues back to the command line", () =>
    Effect.gen(function* () {
      const { err } = yield* exec(Command.runWith(makeRun(config), version)([]));
      process.exitCode = 0;

      expect(err.join("\n")).toContain("<task>");
    })
  );
});

describe("forge simulate", () => {
  it.effect("tallies sinks across runs", () =>
    Effect.gen(function* () {
      const { out } = yield* exec(
        Command.runWith(makeSimulate(config), version)(["ship it", "--runs", "3"])
      );

      expect(parsed(out)).toStrictEqual({
        assembly: "test",
        runs: 3,
        sinks: { done: { count: 3, share: 1 } },
        failures: {},
      });
    })
  );
});

describe("forge inspect", () => {
  it.effect("prints stations and transitions", () =>
    Effect.gen(function* () {
      const { out } = yield* exec(Command.runWith(makeInspect(config), version)([]));

      expect(out.join("\n")).toContain("test-factory");
      expect(out.join("\n")).toContain("→ done on shipped");
    })
  );

  it.effect("emits a mermaid diagram", () =>
    Effect.gen(function* () {
      const { out } = yield* exec(Command.runWith(makeInspect(config), version)(["--mermaid"]));

      expect(out.join("\n")).toContain("stateDiagram-v2");
      expect(out.join("\n")).toContain("work --> done : shipped");
    })
  );
});
