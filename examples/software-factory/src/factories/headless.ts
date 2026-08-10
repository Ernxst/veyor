import { assemble } from "@forge/core";
import { deterministic } from "@forge/core/actors";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../machine.ts";
import { workers } from "./llm.ts";

/**
 * Unattended assembly for agent callers: the same workers, with the authority
 * boundaries held by policy so a run never blocks. Anything policy cannot
 * resolve comes back in the result — deferred items and the decision log —
 * and the caller answers by re-running with `decisions` pre-seeded. The
 * re-run loop is the conversation.
 */
export default assemble(
  DeliveryBlueprint,
  ...workers,

  // Questions get a standing conservative answer, recorded into decisions so
  // every later worker sees it. Work that genuinely cannot proceed on it will
  // surface a contradiction and end up deferred for the caller.
  deterministic(actors.AskUserQuestion, () => ({
    outcome: "answered" as const,
    answer:
      "No user is available this run. Take the most conservative interpretation consistent " +
      "with the plan and the recorded decisions; if none exists, report a contradiction.",
  })),

  // The budget is a hard cap when nobody can authorise more: park the sick
  // item and ship the rest, or end the run if there is nothing to park.
  deterministic(actors.UserReview, ({ context }) => ({
    outcome: context.current === undefined ? ("abandon" as const) : ("defer" as const),
  })),

  // Verification has already certified the delivery; rejection is a human
  // prerogative that an unattended run waives.
  deterministic(actors.Acceptance, () => ({ outcome: "accepted" as const }))
);
