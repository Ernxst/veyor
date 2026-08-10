import { assemble } from "@forge/core";
import { deterministic, probabilistic, type OutcomeWeights } from "@forge/core/actors";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../machine.ts";
import type * as Schema from "../schema.ts";
import * as policy from "./policy.ts";

/**
 * A fixed synthetic backlog so the simulation exercises flow dynamics —
 * dependencies, escalation, bounded refinement, replanning — rather than
 * random plans. All randomness comes from the workers.
 */
const SIMULATED_BACKLOG: readonly Schema.PlannedItem[] = [
  itemOf("scaffold", [], "trivial", "low"),
  itemOf("domain-model", ["scaffold"], "standard", "medium"),
  itemOf("persistence", ["domain-model"], "standard", "medium"),
  itemOf("api", ["persistence"], "standard", "medium"),
  itemOf("sync-engine", ["api"], "complex", "high"),
  itemOf("docs", ["api"], "trivial", "low"),
];

/**
 * A cheap, seeded stand-in for the LLM factory: same blueprint, no models.
 * Reviews model correlated failure — each refine attempt raises the odds of
 * another rejection — so the machine's bounded refine loop has something
 * real to bound.
 */
export default function factory(seed: number) {
  return assemble(
    DeliveryBlueprint,

    // Planning is deterministic in simulation; the merge-on-replan semantics
    // in the blueprint's update are what get exercised.
    deterministic(actors.Planner, () => ({
      outcome: "planned" as const,
      backlog: SIMULATED_BACKLOG,
    })),

    // Deterministic policy shared with the LLM factory
    policy.Selector,
    policy.Integrator,

    // Workers
    probabilistic(actors.TrivialImplementer, {
      seed: seed + 1,
      failureRate: 0.05,
      outcomes: { implemented: 0.96, blocked: 0.02, contradiction: 0.02 },
    }),
    probabilistic(actors.Implementer, {
      seed: seed + 2,
      failureRate: 0.08,
      outcomes: { implemented: 0.92, blocked: 0.05, contradiction: 0.03 },
    }),
    probabilistic(actors.SeniorImplementer, {
      seed: seed + 3,
      failureRate: 0.03,
      outcomes: { implemented: 0.95, blocked: 0.03, contradiction: 0.02 },
    }),
    probabilistic(actors.Reviewer, {
      seed: seed + 4,
      outcomes: sticky({ approved: 0.75, changesRequested: 0.24, contradiction: 0.01 }),
    }),
    probabilistic(actors.AdversarialReviewer, {
      seed: seed + 5,
      outcomes: sticky({ approved: 0.53, changesRequested: 0.45, contradiction: 0.02 }),
    }),
    probabilistic(actors.Refiner, {
      seed: seed + 6,
      outcomes: { refined: 0.9, blocked: 0.04, contradiction: 0.06 },
    }),
    probabilistic(actors.Verifier, {
      seed: seed + 7,
      outcomes: { passed: 0.8, failed: 0.15, blocked: 0.05 },
    }),

    // Self-healing/correction: an item fix is only possible with an item on the line.
    probabilistic(actors.Triage, {
      seed: seed + 8,
      outcomes: ({ context }) =>
        context.current === undefined
          ? { replan: 0.7, escalate: 0.3 }
          : { "fix-item": 0.6, replan: 0.25, escalate: 0.15 },
    }),

    // HITL, simulated
    probabilistic(actors.AskUserQuestion, { seed: seed + 9, outcomes: { answered: 1 } }),
    probabilistic(actors.UserReview, {
      seed: seed + 10,
      outcomes: ({ context }) => userReviewWeights(context),
    }),
    probabilistic(actors.Acceptance, {
      seed: seed + 11,
      outcomes: { accepted: 0.92, rejected: 0.08 },
    })
  );
}

function itemOf(
  id: string,
  dependsOn: readonly string[],
  complexity: Schema.PlannedItem["complexity"],
  risk: Schema.PlannedItem["risk"]
): Schema.PlannedItem {
  return {
    id,
    objective: `Deliver the ${id.replace(/-/g, " ")}`,
    acceptanceCriteria: [`${id} satisfies its contract`],
    dependsOn,
    complexity,
    risk,
  };
}

/** Each refine attempt on the current item raises the odds of another rejection. */
function sticky(base: OutcomeWeights & { changesRequested: number }) {
  return ({ context }: { context: Schema.Context }): OutcomeWeights => ({
    ...base,
    changesRequested: base.changesRequested * (1 + context.attempts),
  });
}

/** A human waves healthy work through and pulls the plug on distressed runs. */
function userReviewWeights(context: Schema.Context): OutcomeWeights {
  const overBudget = context.spend >= context.spendBudget;
  const abandon = overBudget ? 0.5 : 0.02 + 0.28 * distressLevel(context);
  return { continue: 1 - abandon, abandon };
}

/** 0 for a healthy run, 1 for one deep in refine attempts or burning budget. */
function distressLevel(context: Schema.Context): number {
  const spendFraction = context.spend / context.spendBudget;
  return Math.min(1, context.attempts / 4 + Math.max(0, spendFraction - 0.5));
}
