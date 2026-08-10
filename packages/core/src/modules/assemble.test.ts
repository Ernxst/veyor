// @effect-diagnostics asyncFunction:off
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { deterministic } from "../actors/deterministic.ts";
import { schema } from "../lib/schema/effect.ts";
import { actor } from "./actor.ts";
import { assemble } from "./assemble.ts";
import { assign } from "./assignment.ts";
import { machine } from "./machine.ts";
import { sink, task } from "./task.ts";
import { transition } from "./transition.ts";

const Empty = schema(Schema.Struct({}));

describe("assemble().run", () => {
  it("derives task input from context, folds output into context, and resolves at a sink", async () => {
    const Context = schema(
      Schema.Struct({ objective: Schema.String, summary: Schema.optional(Schema.String) })
    );

    const Planner = actor("planner", {
      context: Context,
      input: schema(Schema.Struct({ objective: Schema.String })),
      output: schema(Schema.Struct({ outcome: Schema.Literal("planned"), summary: Schema.String })),
      aggregate: Empty,
    });

    const Blueprint = machine({
      id: "run-result",
      initial: "plan",
      context: Context,
      tasks: [
        task(
          "plan",
          assign(Planner, {
            input: (context) => ({ objective: context.objective }),
            update: ({ context, output }) => ({ ...context, summary: output.summary }),
          })
        ),
        sink("done"),
      ],
      transitions: [transition("plan", "done", { on: "planned" })],
    });

    const plan = vi.fn(({ input }: { input: { objective: string } }) => ({
      outcome: "planned" as const,
      summary: `Plan: ${input.objective}`,
    }));

    const result = await assemble(Blueprint, deterministic(Planner, plan)).run({
      objective: "ship",
    });

    expect(plan).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ input: { objective: "ship" } })
    );
    expect(result).toStrictEqual({
      task: "done",
      context: { objective: "ship", summary: "Plan: ship" },
    });
  });

  it("retries a failing task and re-selects assignments with the new retry count", async () => {
    const Context = schema(Schema.Struct({}));
    const Output = schema(Schema.Struct({ outcome: Schema.Literal("completed") }));

    const Junior = actor("junior", {
      context: Context,
      input: Empty,
      output: Output,
      aggregate: Empty,
    });
    const Senior = actor("senior", {
      context: Context,
      input: Empty,
      output: Output,
      aggregate: Empty,
    });

    const Blueprint = machine({
      id: "retry-escalation",
      initial: "work",
      context: Context,
      retries: 2,
      tasks: [
        task(
          "work",
          assign(Junior, ({ meta }) => meta.retryCount === 0),
          assign(Senior, ({ meta }) => meta.retryCount > 0)
        ),
        sink("done"),
      ],
      transitions: [transition("work", "done", { on: "completed" })],
    });

    const junior = vi.fn(() => {
      throw new Error("junior gave up");
    });
    const senior = vi.fn(() => ({ outcome: "completed" as const }));

    const result = await assemble(
      Blueprint,
      deterministic(Junior, junior),
      deterministic(Senior, senior)
    ).run({});

    expect(junior).toHaveBeenCalledTimes(1);
    expect(senior).toHaveBeenCalledTimes(1);
    expect(result.task).toBe("done");
  });

  it("rejects with the actor error once retries are exhausted", async () => {
    const Context = schema(Schema.Struct({}));
    const Worker = actor("worker", {
      context: Context,
      input: Empty,
      output: schema(Schema.Struct({ outcome: Schema.Literal("completed") })),
      aggregate: Empty,
    });

    const Blueprint = machine({
      id: "retry-exhaustion",
      initial: "work",
      context: Context,
      retries: 1,
      tasks: [task("work", assign(Worker)), sink("done")],
      transitions: [transition("work", "done", { on: "completed" })],
    });

    const worker = vi.fn(() => {
      throw new Error("always broken");
    });

    await expect(assemble(Blueprint, deterministic(Worker, worker)).run({})).rejects.toThrow(
      "always broken"
    );
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("rejects when an outcome has no transition", async () => {
    const Context = schema(Schema.Struct({}));
    const Worker = actor("worker", {
      context: Context,
      input: Empty,
      output: schema(Schema.Struct({ outcome: Schema.Literals(["completed", "skipped"]) })),
      aggregate: Empty,
    });

    const Blueprint = machine({
      id: "missing-transition",
      initial: "work",
      context: Context,
      retries: 0,
      tasks: [task("work", assign(Worker)), sink("done")],
      transitions: [transition("work", "done", { on: "completed" })],
    });

    const factory = assemble(
      Blueprint,
      deterministic(Worker, () => ({ outcome: "skipped" as const }))
    );

    await expect(factory.run({})).rejects.toThrow(
      'Task "work" has no transition for outcome "skipped"'
    );
  });

  it("rejects a context that does not satisfy the machine contract", async () => {
    const Context = schema(Schema.Struct({ objective: Schema.String }));
    const Worker = actor("worker", {
      context: Context,
      input: Empty,
      output: schema(Schema.Struct({ outcome: Schema.Literal("completed") })),
      aggregate: Empty,
    });

    const Blueprint = machine({
      id: "context-contract",
      initial: "work",
      context: Context,
      tasks: [task("work", assign(Worker)), sink("done")],
      transitions: [transition("work", "done", { on: "completed" })],
    });

    const factory = assemble(
      Blueprint,
      deterministic(Worker, () => ({ outcome: "completed" as const }))
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- intentionally invalid
    await expect(factory.run({} as { objective: string })).rejects.toThrow(
      'The context for "context-contract" does not match its schema'
    );
  });
});
