import { assemble } from "@veyorhq/core";
import { deterministic } from "@veyorhq/core/actors";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../blueprint.ts";
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
  deterministic(actors.AskUserQuestion, ({ input, report }) => {
    report?.(`standing conservative answer to: ${input.question.slice(0, 120)}`);
    return {
      outcome: "answered" as const,
      answer:
        "No user is available this run. Take the most conservative interpretation consistent " +
        "with the plan and the recorded decisions; if none exists, report a contradiction.",
    };
  }),

  // The budget is a hard cap when nobody can authorise more: park the sick
  // item and ship the rest, or end the run if there is nothing to park.
  deterministic(actors.UserReview, ({ context, report }) => {
    const outcome = context.current === undefined ? ("abandon" as const) : ("defer" as const);
    report?.(
      outcome === "defer"
        ? `budget exhausted at ${context.spend}/${context.spendBudget}: deferring ${context.current}`
        : `budget exhausted at ${context.spend}/${context.spendBudget} with nothing on the line: abandoning`
    );
    return { outcome };
  }),

  // Verification has already certified the delivery; rejection is a human
  // prerogative that an unattended run waives.
  deterministic(actors.Acceptance, ({ report }) => {
    report?.("verified delivery self-accepts: unattended run waives sign-off");
    return { outcome: "accepted" as const };
  })
);
