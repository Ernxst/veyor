import { assemble } from "@forge/core";
import { probabilistic, type OutcomeWeights } from "@forge/core/actors";
import * as actors from "../actors.ts";
import { MySoftwareFactoryBlueprint } from "../machine.ts";
import type * as Schema from "../schema.ts";
import * as policy from "./policy.ts";

/**
 * A cheap, seeded stand-in for the LLM factory: same blueprint, no models.
 * Reviews model correlated failure — each consecutive rejection raises the
 * odds of another — so the deterministic stall detector has something real
 * to observe.
 */
export default function factory(seed: number) {
  return assemble(
    MySoftwareFactoryBlueprint,

    // Autonomous
    probabilistic(actors.Planner, { seed: seed + 1, failureRate: 0.02 }),
    probabilistic(actors.Resolver, {
      seed: seed + 2,
      outcomes: ({ context }) =>
        context.resolution === undefined
          ? { implement: 1 } // the first commitment is always to build something
          : {
              implement: 0.25,
              review: 0.3,
              verify: 0.2,
              refine: 0.15,
              "ask-user": 0.05,
              escalate: 0.03,
              abandoned: 0.02,
            },
    }),
    probabilistic(actors.TrivialImplementer, { seed: seed + 3, failureRate: 0.1 }),
    probabilistic(actors.Implementer, { seed: seed + 4, failureRate: 0.1 }),
    probabilistic(actors.SeniorImplementer, { seed: seed + 5, failureRate: 0.03 }),
    probabilistic(actors.Reviewer, {
      seed: seed + 6,
      outcomes: sticky({ approved: 0.8, changesRequested: 0.2 }),
    }),
    probabilistic(actors.AdversarialReviewer, {
      seed: seed + 7,
      outcomes: sticky({ approved: 0.5, changesRequested: 0.5 }),
    }),
    probabilistic(actors.Verifier, {
      seed: seed + 8,
      outcomes: { passed: 0.6, incomplete: 0.25, failed: 0.1, escalate: 0.05 },
    }),
    probabilistic(actors.Refiner, {
      seed: seed + 9,
      outcomes: { refined: 0.9, contradiction: 0.1 },
    }),

    // Deterministic policy shared with the LLM factory
    policy.SpendGuard,
    policy.StallDetector,

    // Self-healing/correction
    probabilistic(actors.Triage, {
      seed: seed + 10,
      outcomes: { "minor-fix": 0.5, "wrong-approach": 0.25, "ambiguous-spec": 0.15, escalate: 0.1 },
    }),

    // HITL, simulated
    probabilistic(actors.AskUserQuestion, { seed: seed + 11, outcomes: { answered: 1 } }),
    probabilistic(actors.UserReview, { seed: seed + 12, outcomes: { continue: 0.9, abandon: 0.1 } })
  );
}

/** Each consecutive rejection multiplies the odds of the next one. */
function sticky(base: { approved: number; changesRequested: number }) {
  return ({ context }: { context: Schema.Context }): OutcomeWeights => {
    const streak = rejectionStreak(context.reviewHistory);
    return {
      approved: base.approved,
      changesRequested: base.changesRequested * (1 + streak),
    };
  };
}

function rejectionStreak(history: Schema.Context["reviewHistory"]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.outcome !== "changesRequested") break;
    streak++;
  }

  return streak;
}
