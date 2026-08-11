import { deterministic } from "@veyorhq/core/actors";
import * as actors from "../actors.ts";
import { gateTier, readyItems, unreachableItems, type Item } from "../schema.ts";

/**
 * Selection is scheduling, not judgment: the first pending item whose
 * dependencies are all integrated. An unsatisfiable backlog is a deterministic
 * signal that the plan itself is inconsistent.
 */
export const Selector = deterministic(actors.Selector, ({ input, report }) => {
  const ready = readyItems(input.backlog);
  const next = ready[0];
  if (next !== undefined) {
    report?.(`selected ${next.id} (${next.complexity}/${next.risk}); ${ready.length} ready`);
    return { outcome: "selected" as const, itemId: next.id };
  }

  const pending = input.backlog.filter((item) => item.status === "pending");
  if (pending.length === 0) {
    report?.("backlog exhausted: no pending items");
    return { outcome: "exhausted" as const };
  }

  // Deferral cascades: items blocked by a parked dependency are remainder,
  // not work — the line ships without them. Anything else is a broken plan.
  const unreachable = unreachableItems(input.backlog);
  if (pending.every((item) => unreachable.has(item.id))) {
    report?.(`backlog exhausted: ${pending.length} pending unreachable behind deferrals`);
    return { outcome: "exhausted" as const };
  }

  report?.("backlog inconsistent: cycle or missing dependency");
  return {
    outcome: "inconsistent" as const,
    reason: "pending items form a dependency cycle or reference missing items",
  };
});

/**
 * Integration is the per-item mechanical gate: a delivery factory merges the
 * branch and runs the repository's checks here, failing with findings when
 * the system breaks with the item in place. This example stands that in.
 */
export const Integrator = deterministic(actors.Integrator, ({ input, report }) => {
  report?.(`mechanical gate passed for ${input.itemId}`);
  return { outcome: "integrated" as const };
});

/**
 * A caller that already knows the decomposition — typically another agent —
 * supplies the backlog in the initial context, and planning adopts it for
 * free instead of re-deriving it with a model.
 */
export const PlanAdopter = deterministic(actors.PlanAdopter, ({ input, report }) => {
  report?.(`adopted caller backlog: ${input.backlog.length} items (${tierMix(input.backlog)})`);
  return {
    outcome: "planned" as const,
    backlog: input.backlog.map(({ status: _status, ...item }) => item),
  };
});

/**
 * When every item's review floor was the quality gate, verification's floor
 * is the gate too. A delivery factory shells out to the repository's checks
 * here; this example stands that in.
 */
export const GateVerifier = deterministic(actors.GateVerifier, ({ input, report }) => {
  const integrated = input.backlog.filter((item) => item.status === "integrated").length;
  report?.(`quality gate over ${integrated} integrated item(s): pass`);
  return {
    outcome: "passed" as const,
    notes: "Quality gate passed for the integrated backlog.",
  };
});

/** A fully gate-tier delivery that passed verification needs no sign-off call. */
export const AutoAcceptance = deterministic(actors.AutoAcceptance, ({ input, report }) => {
  report?.(`auto-accepted: all ${input.backlog.length} item(s) gate-tier and verified`);
  return { outcome: "accepted" as const };
});

/** `2 trivial/low, 1 standard/medium` — the shape of a backlog at a glance. */
function tierMix(backlog: readonly Item[]): string {
  const counts = new Map<string, number>();
  for (const item of backlog) {
    const key = gateTier(item) ? "gate-tier" : `${item.complexity}/${item.risk}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts].map(([key, count]) => `${count} ${key}`).join(", ");
}
