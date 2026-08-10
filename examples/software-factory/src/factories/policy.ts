import { deterministic } from "@forge/core/actors";
import * as actors from "../actors.ts";

/** The spend gate is policy, not judgment: pass the commitment through or halt. */
export const SpendGuard = deterministic(actors.SpendGuard, ({ input }) =>
  input.spend >= input.spendBudget
    ? { outcome: "overBudget" as const }
    : { outcome: input.commitment }
);

/** Three consecutive rejections without an accepted change is a stall. */
export const StallDetector = deterministic(actors.StallDetector, ({ input }) => {
  const recent = input.reviewHistory.slice(-3);
  return recent.length === 3 && recent.every((review) => review.outcome === "changesRequested")
    ? { outcome: "stalled" as const, reason: "three consecutive rejections" }
    : { outcome: "progressing" as const };
});
