import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { createActor, toPromise } from "xstate";
import { deterministic } from "../../actors/deterministic.ts";
import { schema } from "../../lib/schema/effect.ts";
import { actor } from "../actor.ts";
import { assign } from "../assignment.ts";
import { machine } from "../machine.ts";
import { sink, task } from "../task.ts";
import { transition } from "../transition.ts";
import { compile } from "./xstate.ts";

const Context = schema(Schema.Struct({ selected: Schema.Literals(["first", "second"]) }));
const Empty = schema(Schema.Struct({}));

const First = actor("first", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literal("first") })),
});

const Second = actor("second", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literal("second") })),
});

const Blueprint = machine({
  id: "xstate-compiler",
  initial: "select",
  context: Context,
  tasks: [
    task(
      "select",
      assign(First, ({ context }) => context.selected === "first"),
      assign(Second, ({ context }) => context.selected === "second")
    ),
    sink("first-done"),
    sink("second-done"),
  ],
  transitions: [
    transition("select", "first-done", { on: "first" }),
    transition("select", "second-done", { on: "second" }),
  ],
});

describe("XState compiler", () => {
  it("selects with machine context, routes by outcome, and completes at a sink", () => {
    const first = vi.fn().mockReturnValueOnce({ outcome: "first" as const });
    const second = vi.fn().mockReturnValueOnce({ outcome: "second" as const });
    const compiled = compile(Blueprint, [
      deterministic(First, first),
      deterministic(Second, second),
    ]);
    const running = createActor(compiled, { input: { selected: "second" } });

    running.start();
    return toPromise(running).then(() => {
      expect(first).toHaveBeenCalledTimes(0);
      expect(second).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          context: { selected: "second" },
          input: undefined,
          meta: { retryCount: 0 },
        })
      );
      expect(running.getSnapshot()).toMatchObject({ status: "done", value: "second-done" });
    });
  });

  it("fails instead of invoking an actor when no assignment is enabled", () => {
    const Worker = actor("worker", {
      context: Empty,
      input: Empty,
      output: schema(Schema.Struct({ outcome: Schema.Literal("completed") })),
    });
    const noEligibleWorker = machine({
      id: "no-enabled-assignment",
      initial: "work",
      context: Empty,
      tasks: [
        task(
          "work",
          assign(Worker, () => false),
          assign(Worker, () => false)
        ),
        sink("done"),
      ],
      transitions: [transition("work", "done", { on: "completed" })],
    });
    const run = vi.fn();
    const compiled = compile(noEligibleWorker, [deterministic(Worker, run)]);

    expect(() => compiled.getInitialSnapshot(undefined, {})).toThrow(
      'Task "work" has no enabled assignment for this context.'
    );
    expect(run).toHaveBeenCalledTimes(0);
  });
});
