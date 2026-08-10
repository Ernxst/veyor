import { claude } from "@forge/anthropic/claude";
import { assemble } from "@forge/core";
import { prompt, question, review } from "@forge/core/actors";
import { codex } from "@forge/openai/codex";
import * as actors from "../actors.ts";
import { MySoftwareFactoryBlueprint } from "../machine.ts";
import * as policy from "./policy.ts";

export default assemble(
  MySoftwareFactoryBlueprint,

  // Decision ownership
  codex(actors.Planner, "gpt-5.6-sol", {
    effort: "xhigh",
    instructions: `
Investigate the task and repository evidence, then model the problem before proposing work.
Produce the smallest coherent sequence of commitments and identify the evidence required to validate each one.
Do not implement, review, or claim completion.
`,
  }),
  codex(actors.Resolver, "gpt-5.6-terra", {
    effort: "medium",
    instructions: `
Select exactly one next coherent commitment from the accepted plan, current evidence, unresolved obligations, and authority boundaries.
Route unresolved user-owned decisions to a human and propose verification only when every execution obligation appears complete.
Do not implement, review, or certify completion.
`,
  }),

  // Execution
  codex(actors.TrivialImplementer, "gpt-5.3-spark", {
    effort: "xhigh",
    instructions: `
Execute only the accepted commitment in the assignment.
Preserve its constraints, unrelated work, compatibility, and recoverability, and produce the observable artifacts required by its proof obligations.
Do not expand scope, perform independent review, or certify completion.
`,
  }),
  codex(actors.Implementer, "gpt-5.6-terra", {
    effort: "high",
    instructions: `
Execute only the accepted commitment in the assignment.
Preserve its constraints, unrelated work, compatibility, and recoverability, and produce the observable artifacts required by its proof obligations.
Do not expand scope, perform independent review, or certify completion.
`,
  }),
  codex(actors.SeniorImplementer, "gpt-5.6-sol", {
    effort: "high",
    instructions: `
Execute only the accepted commitment in the assignment.
Preserve its constraints, unrelated work, compatibility, and recoverability, and produce the observable artifacts required by its proof obligations.
Do not expand scope, perform independent review, or certify completion.
`,
  }),

  // Independent evaluation — a different vendor than the implementers, so the
  // review does not share the implementation model's blind spots.
  claude(actors.Reviewer, "claude-opus-5", {
    effort: "high",
    permissionMode: "dontAsk",
    instructions: `
Review the assigned commitment against its accepted requirements and engineering quality bar.
Find concrete defects in correctness, design, compatibility, maintainability, or scope using observable artifacts rather than the implementer's conclusions.
Do not modify the work or decide whether the overall task is complete.
`,
  }),
  claude(actors.AdversarialReviewer, "claude-opus-5", {
    effort: "xhigh",
    permissionMode: "dontAsk",
    instructions: `
Independently challenge the assigned high-risk commitment.
Generate the smallest set of rival failure explanations that could materially change acceptance, then seek observable evidence capable of falsifying the implementation's claims.
Report concrete findings only. Do not modify the work or decide whether the overall task is complete.
`,
  }),
  codex(actors.Verifier, "gpt-5.6-terra", {
    effort: "high",
    instructions: `
Audit the proposed completion of the overall task.
Determine whether every accepted obligation has claim-matched evidence, every required review is present, all material findings are resolved, authority boundaries were respected, and the repository is coherent.
Do not repeat a general engineering review or repair missing work. Reject absent, contradictory, stale, or proxy evidence and identify the earliest workflow stage that must reopen.
`,
  }),

  // Accepted correction
  codex(actors.Refiner, "gpt-5.6-terra", {
    effort: "high",
    instructions: `
Apply only the accepted findings in the assignment while preserving unaffected decisions and work.
If evidence shows that a finding invalidates the accepted approach rather than requiring a local correction, stop and report the contradiction instead of patching around it.
Do not broaden the redesign or certify completion.
`,
  }),

  // Model repair and recovery
  codex(actors.Triage, "gpt-5.6-sol", {
    effort: "high",
    instructions: `
Diagnose why progress stopped or the same class of failure recurred.
Identify the earliest invalid assumption and classify whether the run needs a minor correction, a new plan, or a user-owned decision.
Do not implement a fix, defend the current approach, or certify completion.
`,
  }),

  // Circuit breakers
  codex(actors.StallDetector, "gpt-5.6-terra", {
    effort: "medium",
    instructions: `
Compare the current state with prior attempts and review history.
Report stalled only when the run is repeating the same issue class or producing no decision-relevant evidence; report progressing when a material uncertainty, obligation, or finding has changed.
Do not repair the work or reinterpret the accepted plan.
`,
  }),
  policy.SpendGuard,

  // Human authority boundaries
  prompt(actors.AskUserQuestion, { format: question() }),
  prompt(actors.UserReview, { format: review() })
);
