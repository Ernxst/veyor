// @effect-diagnostics asyncFunction:off
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import { deterministic } from "../../actors/deterministic.ts";
import { schema } from "../../lib/schema/effect.ts";
import { actor } from "../actor.ts";
import { assemble } from "../assemble.ts";
import { assign } from "../assignment.ts";
import { machine, type Machine } from "../machine.ts";
import { sink, task } from "../task.ts";
import { transition } from "../transition.ts";

const Context = schema(Schema.Struct({ log: Schema.Array(Schema.String) }));
const Empty = schema(Schema.Struct({}));

const Planner = actor("planner", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literal("planned"), plan: Schema.String })),
  aggregate: Empty,
});

const Builder = actor("builder", {
  context: Context,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literal("built"), artifact: Schema.String })),
  aggregate: Empty,
});

const Blueprint = machine({
  id: "replay-test",
  initial: "plan",
  context: Context,
  tasks: [
    task(
      "plan",
      assign(Planner, {
        update: ({ context, output }) => ({ log: [...context.log, output.plan] }),
      })
    ),
    task(
      "build",
      assign(Builder, {
        update: ({ context, output }) => ({ log: [...context.log, output.artifact] }),
      })
    ),
    sink("done"),
  ],
  transitions: [
    transition("plan", "build", { on: "planned" }),
    transition("build", "done", { on: "built" }),
  ],
});

function factory(
  planner: () => { outcome: "planned"; plan: string },
  builder: () => {
    outcome: "built";
    artifact: string;
  }
) {
  return assemble(Blueprint, deterministic(Planner, planner), deterministic(Builder, builder));
}

async function recordRun(): Promise<Machine.RunEvent[]> {
  const events: Machine.RunEvent[] = [];
  const original = factory(
    () => ({ outcome: "planned" as const, plan: "the plan" }),
    () => ({ outcome: "built" as const, artifact: "the artifact" })
  );
  await original.run({ log: [] }, { observer: (event) => events.push(event) });
  return events;
}

describe("replay", () => {
  it("replays recorded outputs without invoking workers", async () => {
    const events = await recordRun();

    const planner = vi.fn(() => ({ outcome: "planned" as const, plan: "different" }));
    const builder = vi.fn(() => ({ outcome: "built" as const, artifact: "different" }));
    const replayed: Machine.RunEvent[] = [];
    const result = await factory(planner, builder).run(
      { log: [] },
      { replay: events, observer: (event) => replayed.push(event) }
    );

    expect(planner).not.toHaveBeenCalled();
    expect(builder).not.toHaveBeenCalled();
    expect(result.task).toBe("done");
    expect(result.context.log).toStrictEqual(["the plan", "the artifact"]);
    expect(
      replayed.filter((event) => event.type === "complete").map((event) => event.replayed)
    ).toStrictEqual([true, true]);
  });

  it("runs live past the end of the record", async () => {
    const events = await recordRun();
    const partial = events.filter(
      (event) => !(event.type === "complete" && event.actor === "builder")
    );

    const builder = vi.fn(() => ({ outcome: "built" as const, artifact: "fresh" }));
    const result = await factory(
      () => ({ outcome: "planned" as const, plan: "unused" }),
      builder
    ).run({ log: [] }, { replay: partial });

    expect(builder).toHaveBeenCalledTimes(1);
    expect(result.context.log).toStrictEqual(["the plan", "fresh"]);
  });

  it("fails loudly when the record diverges from the machine", async () => {
    const events = await recordRun();
    const reordered = [...events].reverse();

    await expect(
      factory(
        () => ({ outcome: "planned" as const, plan: "unused" }),
        () => ({ outcome: "built" as const, artifact: "unused" })
      ).run({ log: [] }, { replay: reordered })
    ).rejects.toThrow(/Replay diverged/);
  });
});
