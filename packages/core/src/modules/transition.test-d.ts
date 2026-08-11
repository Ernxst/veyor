import * as Schema from "effect/Schema";
import { assertType, expectTypeOf, test } from "vitest";
import { actor, assign, machine, sink, task, transition, type Transition } from "../index.ts";
import { schema } from "../lib/schema/effect.ts";

const Empty = schema(Schema.Struct({}));

const Worker = actor("worker", {
  context: Empty,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literals(["completed", "changesRequested"]) })),
});

const Reviewer = actor("reviewer", {
  context: Empty,
  input: Empty,
  output: schema(Schema.Struct({ outcome: Schema.Literals(["approved", "rejected"]) })),
});

const tasks = [
  task("work", assign(Worker)),
  task("review", assign(Reviewer)),
  sink("done"),
] as const;

test("preserves the transition literals", () => {
  const value = transition("work", "review", { on: "completed" });

  expectTypeOf(value).toEqualTypeOf<Transition<"work", "review", "completed">>();
});

test("accepts outcomes emitted by the source task", () => {
  const transitions = [
    transition("work", "review", { on: "completed" }),
    transition("work", "work", { on: "changesRequested" }),
    transition("review", "done", { on: "approved" }),
    transition("review", "work", { on: "rejected" }),
  ] as const;

  assertType<Transition.From<typeof tasks>>(transitions);

  const blueprint = machine({
    id: "typed-transitions",
    initial: "work",
    context: Empty,
    tasks,
    transitions,
  });

  expectTypeOf(blueprint.transitions).toEqualTypeOf<typeof transitions>();
});

test("rejects an outcome not emitted by the source task", () => {
  assertType(
    machine({
      id: "invalid-outcome",
      initial: "work",
      context: Empty,
      tasks,
      transitions: [
        // @ts-expect-error -- "approved" is not an outcome of the work task.
        transition("work", "done", { on: "approved" }),
      ],
    })
  );
});

test("rejects an unknown target task", () => {
  assertType(
    machine({
      id: "invalid-target",
      initial: "work",
      context: Empty,
      tasks,
      transitions: [
        // @ts-expect-error -- "missing" is not a task in this machine.
        transition("work", "missing", { on: "completed" }),
      ],
    })
  );
});

test("rejects an outgoing transition from a sink", () => {
  assertType(
    machine({
      id: "invalid-sink-source",
      initial: "work",
      tasks,
      transitions: [
        // @ts-expect-error -- sink tasks cannot have outgoing transitions.
        transition("done", "work", { on: "completed" }),
      ],
    })
  );
});
