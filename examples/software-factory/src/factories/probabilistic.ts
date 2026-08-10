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
      outcomes: ({ context }) => resolverWeights(context),
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
    probabilistic(actors.UserReview, {
      seed: seed + 12,
      outcomes: ({ context }) => userReviewWeights(context),
    })
  );
}

/**
 * Abandonment is evidence-driven, not memoryless. A flat per-decision quit
 * weight compounds over a run's many resolve cycles into implausible run-level
 * abandonment (a constant 2% per decision abandons ~19% of runs); a resolver
 * only quits under sustained distress.
 */
function resolverWeights(context: Schema.Context): OutcomeWeights {
  if (context.resolution === undefined) return { implement: 1 };

  const distress = distressLevel(context);
  return {
    implement: 0.25,
    review: 0.3,
    verify: 0.2,
    refine: 0.15,
    "ask-user": 0.02 + 0.08 * distress,
    escalate: 0.01 + 0.09 * distress,
    abandoned: 0.1 * distress ** 2,
  };
}

/** A human waves work through when it is healthy and pulls the plug when it is not. */
function userReviewWeights(context: Schema.Context): OutcomeWeights {
  const overBudget = context.spend >= context.spendBudget;
  const abandon = overBudget ? 0.5 : 0.02 + 0.28 * distressLevel(context);
  return { continue: 1 - abandon, abandon };
}

/**
 * How troubled this run looks: 0 for a healthy run, 1 for one deep in
 * consecutive rejections or burning through its budget.
 */
function distressLevel(context: Schema.Context): number {
  const streak = rejectionStreak(context.reviewHistory);
  const spendFraction = context.spend / context.spendBudget;
  return Math.min(1, streak / 4 + Math.max(0, spendFraction - 0.5));
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
