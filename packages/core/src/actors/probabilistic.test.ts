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

  it("derives failure rate from success rate when no explicit failure rate is supplied", async () => {
    const review = probabilistic(Review, { seed: 1, successRate: 0 });

    await expect(review.run(taskInput(false))).rejects.toThrow(
      'Probabilistic actor "review" failed as configured.'
    );
  });

  it("gives an explicit failure rate precedence over success rate", async () => {
    const review = probabilistic(Review, {
      seed: 1,
      failureRate: 0,
      successRate: 0,
      outcomes: { approved: 1 },
    });

    await expect(review.run(taskInput(false))).resolves.toHaveProperty("outcome", "approved");
  });

  it("rejects a configured outcome that the actor cannot emit", async () => {
    const review = probabilistic(Review, { seed: 1, outcomes: { unknown: 1 } });

    await expect(review.run(taskInput(false))).rejects.toThrow(
      'No branch of this output schema produces the outcome "unknown".'
    );
  });

  it("rejects an empty outcome distribution", async () => {
    const noOutcomes = probabilistic(Review, { seed: 1, outcomes: {} });

    await expect(noOutcomes.run(taskInput(false))).rejects.toThrow(
      "Provide at least one probabilistic outcome."
    );
  });

  it("requires an outcome distribution to contain a positive, finite weight", async () => {
    const zeroWeight = probabilistic(Review, {
      seed: 1,
      outcomes: { approved: 0, changesRequested: 0 },
    });

    await expect(zeroWeight.run(taskInput(false))).rejects.toThrow(
      "Provide at least one probabilistic outcome with a positive, finite weight."
    );
  });

  it("rejects negative outcome weights", async () => {
    const negativeWeight = probabilistic(Review, {
      seed: 1,
      outcomes: { approved: 1, changesRequested: -1 },
    });

    await expect(negativeWeight.run(taskInput(false))).rejects.toThrow(
      "Probabilistic outcome weights must be finite and non-negative."
    );
  });

  it("rejects non-finite outcome weights", async () => {
    const infiniteWeight = probabilistic(Review, { seed: 1, outcomes: { approved: Infinity } });

    await expect(infiniteWeight.run(taskInput(false))).rejects.toThrow(
      "Probabilistic outcome weights must be finite and non-negative."
    );
  });

  it("rejects probability rates outside the inclusive zero-to-one range", () => {
    expect(() => probabilistic(Review, { failureRate: -0.01 })).toThrow(
      "Probabilistic failureRate must be a finite number between 0 and 1."
    );
    expect(() => probabilistic(Review, { successRate: 1.01 })).toThrow(
      "Probabilistic successRate must be a finite number between 0 and 1."
    );
  });
});
