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
  aggregate: Empty,
});

const Second = actor("second", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literal("second") })),
  aggregate: Empty,
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
    const first = vi.fn(() => ({ outcome: "first" as const }));
    const second = vi.fn(() => ({ outcome: "second" as const }));
    const compiled = compile(Blueprint, [
      deterministic(First, first),
      deterministic(Second, second),
    ]);
    const running = createActor(compiled, { input: { selected: "second" } });

    running.start();
    return toPromise(running).then(() => {
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      expect(running.getSnapshot()).toMatchObject({ status: "done", value: "second-done" });
    });
  });
});
