// @effect-diagnostics asyncFunction:off
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { schema } from "../lib/schema/effect.ts";
import { actor } from "../modules/actor.ts";
import type { Task } from "../modules/task.ts";
import { probabilistic } from "./probabilistic.ts";

const Empty = schema(Schema.Struct({}));

const Review = actor("review", {
  context: schema(Schema.Struct({ strict: Schema.Boolean })),
  input: Empty,
  output: schema(
    Schema.Union([
      Schema.Struct({ outcome: Schema.Literal("approved"), notes: Schema.String }),
      Schema.Struct({ outcome: Schema.Literal("changesRequested"), reason: Schema.String }),
    ])
  ),
  aggregate: Empty,
});

function taskInput(strict: boolean): Task.Input<{ strict: boolean }, object> {
  return {
    context: { strict },
    input: {},
    meta: { retryCount: 0 },
    signal: new AbortController().signal,
  };
}

describe("probabilistic", () => {
  it("generates a full schema-valid output for the picked outcome", async () => {
    const review = probabilistic(Review, { seed: 7, outcomes: { approved: 1 } });

    const output = await review.run(taskInput(false));

    expect(output.outcome).toBe("approved");
    // The rest of the branch is generated too, not just the outcome.
    expect(output).toHaveProperty("notes", expect.any(String));
  });

  it("derives outcome weights from the live task input", async () => {
    const review = probabilistic(Review, {
      seed: 7,
      outcomes: ({ context }) => (context.strict ? { changesRequested: 1 } : { approved: 1 }),
    });

    await expect(review.run(taskInput(true))).resolves.toHaveProperty(
      "outcome",
      "changesRequested"
    );
    await expect(review.run(taskInput(false))).resolves.toHaveProperty("outcome", "approved");
  });

  it("replays the same seeded sequence across implementations", async () => {
    const runs = async () => {
      const review = probabilistic(Review, {
        seed: 42,
        outcomes: { approved: 0.5, changesRequested: 0.5 },
      });
      return [await review.run(taskInput(false)), await review.run(taskInput(false))];
    };

    await expect(runs()).resolves.toStrictEqual(await runs());
  });

  it("fails at the configured rate", async () => {
    const review = probabilistic(Review, { seed: 1, failureRate: 1 });

    await expect(review.run(taskInput(false))).rejects.toThrow(
      'Probabilistic actor "review" failed as configured.'
    );
  });
});
