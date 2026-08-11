import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  actor,
  assemble,
  assign,
  machine,
  sink,
  task,
  transition,
  type Machine,
} from "@veyorhq/core";
import { deterministic } from "@veyorhq/core/actors";
import { schema } from "@veyorhq/core/schema/effect";
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

const RoutedWorker = actor("routed-worker", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literals(["approved", "rejected"]) })),
  aggregate: Empty,
});

const RoutedBlueprint = machine({
  id: "routed-factory",
  initial: "work",
  context: Context,
  tasks: [task("work", assign(RoutedWorker)), sink("approved"), sink("rejected")],
  transitions: [
    transition("work", "approved", { on: "approved" }),
    transition("work", "rejected", { on: "rejected" }),
  ],
});

const routed = (outcome: "approved" | "rejected") =>
  assemble(
    RoutedBlueprint,
    deterministic(RoutedWorker, () => ({ outcome }))
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

describe("veyor run", () => {
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

  it.effect("uses the explicit assembly over the configured default", () =>
    Effect.gen(function* () {
      const selectionConfig = defineConfig({
        assemblies: { approved: routed("approved"), rejected: routed("rejected") },
        args: [{ key: "input.task", position: 0 }],
        run: { assembly: "approved" },
      });

      const { out } = yield* exec(
        Command.runWith(makeRun(selectionConfig), version)(["ship it", "--assembly", "rejected"])
      );

      expect(parsed(out)).toMatchObject({ task: "rejected" });
    })
  );
});

describe("veyor simulate", () => {
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
        context: {
          budget: { mean: 1, min: 1, max: 1 },
          attempts: { mean: 0, min: 0, max: 0 },
        },
      });
    })
  );

  it.effect("keeps successful sinks and failed runs separate across seeded simulations", () =>
    Effect.gen(function* () {
      const seeded = (seed: number): Machine.Impl<typeof RoutedBlueprint> => {
        const impl = routed(seed % 2 === 0 ? "approved" : "rejected");
        return {
          ...impl,
          run: (context, options) =>
            seed === 12
              ? Promise.reject(new Error("simulated outage"))
              : impl.run(context, options),
        };
      };
      const simulationConfig = defineConfig({
        assemblies: { simulated: seeded },
        args: [{ key: "input.task", position: 0 }],
      });

      const { out } = yield* exec(
        Command.runWith(
          makeSimulate(simulationConfig),
          version
        )(["ship it", "--runs", "4", "--seed", "10"])
      );

      expect(parsed(out)).toStrictEqual({
        assembly: "simulated",
        runs: 4,
        sinks: {
          approved: { count: 1, share: 0.25 },
          rejected: { count: 2, share: 0.5 },
        },
        failures: { "simulated outage": 1 },
        context: {
          budget: { mean: 1, min: 1, max: 1 },
          attempts: { mean: 0, min: 0, max: 0 },
        },
      });
    })
  );
});

describe("veyor inspect", () => {
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
