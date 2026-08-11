import { deterministic } from "@forge/core/actors";
import * as actors from "../actors.ts";
import { readyItems, unreachableItems } from "../backlog.ts";

/**
 * Selection is scheduling, not judgment: the first pending item whose
 * dependencies are all integrated. An unsatisfiable backlog is a deterministic
 * signal that the plan itself is inconsistent.
 */
export const Selector = deterministic(actors.Selector, ({ input }) => {
  const ready = readyItems(input.backlog);
  if (ready[0] !== undefined) return { outcome: "selected" as const, itemId: ready[0].id };

  const pending = input.backlog.filter((item) => item.status === "pending");
  if (pending.length === 0) return { outcome: "exhausted" as const };

  // Deferral cascades: items blocked by a parked dependency are remainder,
  // not work — the line ships without them. Anything else is a broken plan.
  const unreachable = unreachableItems(input.backlog);
  return pending.every((item) => unreachable.has(item.id))
    ? { outcome: "exhausted" as const }
    : {
        outcome: "inconsistent" as const,
        reason: "pending items form a dependency cycle or reference missing items",
      };
});

/**
 * Integration is the per-item mechanical gate: a delivery factory merges the
 * branch and runs the repository's checks here, failing with findings when
 * the system breaks with the item in place. This example stands that in.
 */
export const Integrator = deterministic(actors.Integrator, () => ({
  outcome: "integrated" as const,
}));

/**
 * A caller that already knows the decomposition — typically another agent —
 * supplies the backlog in the initial context, and planning adopts it for
 * free instead of re-deriving it with a model.
 */
export const PlanAdopter = deterministic(actors.PlanAdopter, ({ input }) => ({
  outcome: "planned" as const,
  backlog: input.backlog.map(({ status: _status, ...item }) => item),
}));

/**
 * When every item's review floor was the quality gate, verification's floor
 * is the gate too. A delivery factory shells out to the repository's checks
 * here; this example stands that in.
 */
export const GateVerifier = deterministic(actors.GateVerifier, () => ({
  outcome: "passed" as const,
  notes: "Quality gate passed for the integrated backlog.",
}));

/** A fully gate-tier delivery that passed verification needs no sign-off call. */
export const AutoAcceptance = deterministic(actors.AutoAcceptance, () => ({
  outcome: "accepted" as const,
}));
