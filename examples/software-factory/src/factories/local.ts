// Maiden-voyage assembly: every worker on opencode's free model tier so WIP
// runs never touch subscription usage. Run it with:
//   bun run deliver "<task>" --factory local
import { assemble } from "@forge/core";
import { acceptance, prompt, question, review } from "@forge/core/actors";
import { opencode } from "@forge/opencode";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../machine.ts";
import * as policy from "./policy.ts";

const FREE = "opencode/deepseek-v4-flash-free";

const implementerInstructions = `
Execute only the assigned backlog item, honouring its acceptance criteria and the recorded
user decisions. If the item is ambiguous in a way only the user can resolve, report blocked
with the question; if it conflicts with the plan, report a contradiction. Do not expand
scope or certify completion.
`;

export default assemble(
  DeliveryBlueprint,

  opencode(actors.Planner, FREE, {
    instructions:
      "Decompose the task into a backlog of items with acceptance criteria, dependencies, complexity, and risk. Do not emit an item smaller than its ceremony.",
  }),

  policy.PlanAdopter,
  policy.Selector,
  policy.Integrator,
  policy.GateVerifier,
  policy.AutoAcceptance,

  opencode(actors.TrivialImplementer, FREE, { instructions: implementerInstructions }),
  opencode(actors.Implementer, FREE, { instructions: implementerInstructions }),
  opencode(actors.SeniorImplementer, FREE, { instructions: implementerInstructions }),

  opencode(actors.GateReviewer, FREE, {
    instructions:
      "Confirm the delivered item passes basic checks; report approved or changesRequested with findings.",
  }),
  opencode(actors.Reviewer, FREE, {
    instructions:
      "Review the delivered item against its acceptance criteria. Report approved, or changesRequested with concrete findings.",
  }),
  opencode(actors.AdversarialReviewer, FREE, {
    instructions:
      "Adversarially challenge this high-risk item; seek evidence that falsifies its claims. Report approved or changesRequested with findings.",
  }),

  opencode(actors.Refiner, FREE, {
    instructions: "Apply only the accepted findings. Report refined, blocked, or contradiction.",
  }),
  opencode(actors.Verifier, FREE, {
    instructions:
      "Audit the completed backlog against the task. Report passed, or failed with the specific gaps as evidence.",
  }),
  opencode(actors.Triage, FREE, {
    instructions:
      "Classify the repair: fix-item with a revised objective, split into fragments, defer, replan, or escalate.",
  }),

  // Attended: you hold the authority boundaries while watching the maiden voyage.
  prompt(actors.AskUserQuestion, { format: question() }),
  prompt(actors.UserReview, { format: review() }),
  prompt(actors.Acceptance, { format: acceptance() })
);
