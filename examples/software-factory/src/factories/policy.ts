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
