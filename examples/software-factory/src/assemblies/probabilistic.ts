import { assemble } from "@veyor/core";
import { deterministic, probabilistic, type OutcomeWeights } from "@veyor/core/actors";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../blueprint.ts";
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
    policy.PlanAdopter,
    policy.Selector,
    policy.GateVerifier,
    policy.AutoAcceptance,

    // Integration is the mechanical gate: review approved the change, but the
    // whole system can still fail checks with it in place.
    probabilistic(actors.Integrator, {
      seed: seed + 13,
      outcomes: { integrated: 0.95, failed: 0.05 },
    }),

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
    // The gate tier models the deterministic quality gate: cheap, consistent,
    // occasionally failing checks. Model reviewers carry judgment and stickiness.
    probabilistic(actors.GateReviewer, {
      seed: seed + 12,
      outcomes: { approved: 0.93, changesRequested: 0.07 },
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

    // Self-healing/correction: item-scoped repairs are only possible with an
    // item on the line; splitting only makes sense above trivial granularity.
    probabilistic(actors.Triage, {
      seed: seed + 8,
      outcomes: ({ context }) => {
        const item = context.backlog.find((candidate) => candidate.id === context.current);
        if (item === undefined) return { replan: 0.7, escalate: 0.3 };
        // Budget pressure: cut scope to fit (defer ships the remainder) or
        // escalate for funding — never patch around an exhausted budget.
        if (context.spend >= context.spendBudget) return { defer: 0.65, escalate: 0.35 };
        return item.complexity === "trivial"
          ? { "fix-item": 0.45, defer: 0.25, replan: 0.15, escalate: 0.15 }
          : { "fix-item": 0.3, split: 0.25, defer: 0.2, replan: 0.15, escalate: 0.1 };
      },
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

/**
 * A human waves healthy work through; on a distressed run they prefer parking
 * the sick item and shipping the rest over abandoning everything.
 */
function userReviewWeights(context: Schema.Context): OutcomeWeights {
  const overBudget = context.spend >= context.spendBudget;
  const canDefer = context.current !== undefined;
  const distress = overBudget ? 1 : distressLevel(context);
  const decline = overBudget ? 0.6 : 0.03 + 0.3 * distress;
  const defer = canDefer ? decline * 0.7 : 0;
  return { continue: 1 - decline, defer, abandon: decline - defer };
}

/** 0 for a healthy run, 1 for one deep in refine attempts or burning budget. */
function distressLevel(context: Schema.Context): number {
  const spendFraction = context.spend / context.spendBudget;
  return Math.min(1, context.attempts / 4 + Math.max(0, spendFraction - 0.5));
}
