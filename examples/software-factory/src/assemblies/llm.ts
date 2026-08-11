import { claude } from "@veyorhq/anthropic/claude";
import { assemble } from "@veyorhq/core";
import { acceptance, deterministic, prompt, question, review } from "@veyorhq/core/actors";
import { codex } from "@veyorhq/openai/codex";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../blueprint.ts";
import * as policy from "./policy.ts";

const implementerInstructions = `
Execute only the assigned backlog item, honouring its acceptance criteria and the recorded
user decisions. Preserve unrelated work, compatibility, and recoverability. If the item is
ambiguous in a way only the user can resolve, report blocked with the question; if it
conflicts with the plan, report a contradiction. Do not expand scope or certify completion.
`;

// Claude workers share dontAsk permission; effort is the only per-role knob.
// Codex tiers escalate luna -> terra -> sol, by model and effort.
const fable5Xhigh = claude.preset({
  model: "claude-fable-5",
  effort: "xhigh",
  permissionMode: "dontAsk",
});
const fable5High = claude.preset({
  model: "claude-fable-5",
  effort: "high",
  permissionMode: "dontAsk",
});
const sonnet5High = claude.preset({
  model: "claude-sonnet-5",
  effort: "high",
  permissionMode: "dontAsk",
});
const opus5Xhigh = claude.preset({
  model: "claude-opus-5",
  effort: "xhigh",
  permissionMode: "dontAsk",
});
const lunaMedium = codex.preset({ model: "gpt-5.6-luna", effort: "medium" });
const terraHigh = codex.preset({ model: "gpt-5.6-terra", effort: "high" });
const solXhigh = codex.preset({ model: "gpt-5.6-sol", effort: "xhigh" });
const solHigh = codex.preset({ model: "gpt-5.6-sol", effort: "high" });

/** Every worker below the authority boundary, shared with the headless assembly. */
export const workers = [
  // Planning owns the model of the work: a backlog of items with acceptance
  // criteria and dependencies. On a replan it receives the current backlog
  // and the accumulated decisions as evidence.
  fable5Xhigh(actors.Planner, {
    instructions: `
Investigate the task and repository evidence, then decompose the work into a backlog of
independent items with explicit acceptance criteria, dependencies, complexity, and risk.
Do not emit an item smaller than its ceremony: batch related trivial changes into one item.
On a replan, preserve the intent of integrated items and revise only what the evidence
invalidates. Do not implement, review, or claim completion.
`,
  }),

  // Scheduling, integration, and the free floors of planning, verification,
  // and acceptance are deterministic policy, not judgment.
  policy.PlanAdopter,
  policy.Selector,
  policy.Integrator,
  policy.GateVerifier,
  policy.AutoAcceptance,

  // Execution: harder items and repeated failure escalate to more capable workers.
  lunaMedium(actors.TrivialImplementer, { instructions: implementerInstructions }),
  terraHigh(actors.Implementer, { instructions: implementerInstructions }),
  solXhigh(actors.SeniorImplementer, { instructions: implementerInstructions }),

  // Independent evaluation — the reviewer scales with the stakes. Trivial
  // low-risk items get the deterministic quality gate (a real delivery
  // factory shells out to the repository's own checks here); standard items
  // a light model; high-risk items an adversarial cross-vendor review.
  deterministic(actors.GateReviewer, ({ input }) => ({
    outcome: "approved" as const,
    notes: `Quality gate passed for "${input.item.id}".`,
  })),
  sonnet5High(actors.Reviewer, {
    instructions: `
Review the delivered item against its acceptance criteria and engineering quality bar.
Find concrete defects using observable artifacts rather than the implementer's conclusions.
If the item as specified conflicts with the plan, report a contradiction instead of findings.
Do not modify the work or decide whether the overall task is complete.
`,
  }),
  opus5Xhigh(actors.AdversarialReviewer, {
    instructions: `
Independently challenge this high-risk item. Generate the smallest set of rival failure
explanations that could materially change acceptance, then seek observable evidence capable
of falsifying the implementation's claims. Report concrete findings only.
`,
  }),

  // Accepted correction
  terraHigh(actors.Refiner, {
    instructions: `
Apply only the accepted findings while preserving unaffected decisions and work.
If evidence shows a finding invalidates the item's approach rather than requiring a local
correction, report a contradiction instead of patching around it. If a finding cannot be
resolved without a user-owned decision, report blocked with the question.
`,
  }),

  // Verification certifies the whole delivery, once, against the plan.
  solHigh(actors.Verifier, {
    instructions: `
Audit the completed backlog against the original task. Determine whether every item's
acceptance criteria have claim-matched evidence and the delivery is coherent as a whole.
Reject absent, contradictory, stale, or proxy evidence with the specific gaps as evidence.
Do not repair missing work.
`,
  }),

  // Model repair and recovery
  fable5High(actors.Triage, {
    instructions: `
Diagnose why progress stopped and classify the repair: respecify the failing item
(fix-item, with a revised objective), split it into smaller fragments, defer it so the
rest of the backlog ships, replan because the model itself is invalid, or escalate a
user-owned decision. Identify the earliest invalid assumption.
When the budget is exhausted (spend >= spendBudget), prefer defer — ship the remainder —
or escalate for more funding; never fix or split your way around a budget limit.
Do not implement a fix or defend the current approach.
`,
  }),
] as const;

// Attended assembly: a terminal human holds the authority boundaries.
export default assemble(
  DeliveryBlueprint,
  ...workers,
  prompt(actors.AskUserQuestion, { format: question() }),
  prompt(actors.UserReview, { format: review() }),
  prompt(actors.Acceptance, { format: acceptance() })
);
