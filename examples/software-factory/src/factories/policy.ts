import { deterministic } from "@forge/core/actors";
import * as actors from "../actors.ts";

/**
 * Selection is scheduling, not judgment: the first pending item whose
 * dependencies are all integrated. An unsatisfiable backlog is a deterministic
 * signal that the plan itself is inconsistent.
 */
export const Selector = deterministic(actors.Selector, ({ input }) => {
  const pending = input.backlog.filter((item) => item.status === "pending");
  if (pending.length === 0) return { outcome: "exhausted" as const };

  const integrated = new Set(
    input.backlog.filter((item) => item.status === "integrated").map((item) => item.id)
  );
  const ready = pending.find((item) => item.dependsOn.every((dep) => integrated.has(dep)));
  return ready !== undefined
    ? { outcome: "selected" as const, itemId: ready.id }
    : {
        outcome: "inconsistent" as const,
        reason: "no pending item has all of its dependencies integrated",
      };
});

/** Integration is bookkeeping here; a delivery factory would merge the branch. */
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
