import { mkdirSync } from "node:fs";
// Maiden-voyage assembly: every worker on opencode's free model tier so WIP
// runs never touch subscription usage. Run it with:
//   bun run deliver "<task>" --factory local
// Workers act inside an isolated workspace, never this repository — see
// fixtures/README.md for reproducible scenarios.
import { assemble } from "@veyorhq/core";
import { acceptance, prompt, question, review } from "@veyorhq/core/actors";
import { opencode } from "@veyorhq/opencode";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../blueprint.ts";
import * as policy from "./policy.ts";

const FREE = "opencode/deepseek-v4-flash-free";

/** Where workers act. Agentic workers with tools must never run in this repo. */
const workspace = process.env.VEYOR_WORKSPACE ?? "/tmp/veyor-voyage";
mkdirSync(workspace, { recursive: true });

const worker = opencode.preset({ model: FREE, cwd: workspace });

const implementerInstructions = `
Execute only the assigned backlog item, honouring its acceptance criteria and the recorded
user decisions. If the item is ambiguous in a way only the user can resolve, report blocked
with the question; if it conflicts with the plan, report a contradiction. Do not expand
scope or certify completion.
`;

export default assemble(
  DeliveryBlueprint,

  worker(actors.Planner, {
    instructions:
      "Decompose the task into a backlog of items with acceptance criteria, dependencies, complexity, and risk. Do not emit an item smaller than its ceremony.",
  }),

  policy.PlanAdopter,
  policy.Selector,
  policy.Integrator,
  policy.GateVerifier,
  policy.AutoAcceptance,

  worker(actors.TrivialImplementer, { instructions: implementerInstructions }),
  worker(actors.Implementer, { instructions: implementerInstructions }),
  worker(actors.SeniorImplementer, { instructions: implementerInstructions }),

  worker(actors.GateReviewer, {
    instructions:
      "Confirm the delivered item passes basic checks; report approved or changesRequested with findings.",
  }),
  worker(actors.Reviewer, {
    instructions:
      "Review the delivered item against its acceptance criteria. Report approved, or changesRequested with concrete findings.",
  }),
  worker(actors.AdversarialReviewer, {
    instructions:
      "Adversarially challenge this high-risk item; seek evidence that falsifies its claims. Report approved or changesRequested with findings.",
  }),

  worker(actors.Refiner, {
    instructions: "Apply only the accepted findings. Report refined, blocked, or contradiction.",
  }),
  worker(actors.Verifier, {
    instructions:
      "Audit the completed backlog against the task. Report passed, or failed with the specific gaps as evidence.",
  }),
  worker(actors.Triage, {
    instructions:
      "Classify the repair: fix-item with a revised objective, split into fragments, defer, replan, or escalate. When spend >= spendBudget, prefer defer or escalate.",
  }),

  // Attended: you hold the authority boundaries while watching the maiden voyage.
  prompt(actors.AskUserQuestion, { format: question() }),
  prompt(actors.UserReview, { format: review() }),
  prompt(actors.Acceptance, { format: acceptance() })
);
