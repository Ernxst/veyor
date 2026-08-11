import { mkdirSync } from "node:fs";
// Maiden-voyage assembly: every worker on opencode's free model tier so WIP
// runs never touch subscription usage. Run it with:
//   bun run deliver "<task>" --factory local
// Workers act inside an isolated workspace, never this repository — see
// fixtures/README.md for reproducible scenarios.
import { assemble } from "@veyor/core";
import { acceptance, prompt, question, review } from "@veyor/core/actors";
import { opencode, type OpencodeOptions } from "@veyor/opencode";
import * as actors from "../actors.ts";
import { DeliveryBlueprint } from "../blueprint.ts";
import * as policy from "./policy.ts";

const FREE = "opencode/deepseek-v4-flash-free";

/** Where workers act. Agentic workers with tools must never run in this repo. */
const workspace = process.env.VEYOR_WORKSPACE ?? "/tmp/veyor-voyage";
mkdirSync(workspace, { recursive: true });

function worker(options: Omit<OpencodeOptions, "cwd">): OpencodeOptions {
  return { ...options, cwd: workspace };
}

const implementerInstructions = `
Execute only the assigned backlog item, honouring its acceptance criteria and the recorded
user decisions. If the item is ambiguous in a way only the user can resolve, report blocked
with the question; if it conflicts with the plan, report a contradiction. Do not expand
scope or certify completion.
`;

export default assemble(
  DeliveryBlueprint,

  opencode(
    actors.Planner,
    FREE,
    worker({
      instructions:
        "Decompose the task into a backlog of items with acceptance criteria, dependencies, complexity, and risk. Do not emit an item smaller than its ceremony.",
    })
  ),

  policy.PlanAdopter,
  policy.Selector,
  policy.Integrator,
  policy.GateVerifier,
  policy.AutoAcceptance,

  opencode(actors.TrivialImplementer, FREE, worker({ instructions: implementerInstructions })),
  opencode(actors.Implementer, FREE, worker({ instructions: implementerInstructions })),
  opencode(actors.SeniorImplementer, FREE, worker({ instructions: implementerInstructions })),

  opencode(
    actors.GateReviewer,
    FREE,
    worker({
      instructions:
        "Confirm the delivered item passes basic checks; report approved or changesRequested with findings.",
    })
  ),
  opencode(
    actors.Reviewer,
    FREE,
    worker({
      instructions:
        "Review the delivered item against its acceptance criteria. Report approved, or changesRequested with concrete findings.",
    })
  ),
  opencode(
    actors.AdversarialReviewer,
    FREE,
    worker({
      instructions:
        "Adversarially challenge this high-risk item; seek evidence that falsifies its claims. Report approved or changesRequested with findings.",
    })
  ),

  opencode(
    actors.Refiner,
    FREE,
    worker({
      instructions: "Apply only the accepted findings. Report refined, blocked, or contradiction.",
    })
  ),
  opencode(
    actors.Verifier,
    FREE,
    worker({
      instructions:
        "Audit the completed backlog against the task. Report passed, or failed with the specific gaps as evidence.",
    })
  ),
  opencode(
    actors.Triage,
    FREE,
    worker({
      instructions:
        "Classify the repair: fix-item with a revised objective, split into fragments, defer, replan, or escalate. When spend >= spendBudget, prefer defer or escalate.",
    })
  ),

  // Attended: you hold the authority boundaries while watching the maiden voyage.
  prompt(actors.AskUserQuestion, { format: question() }),
  prompt(actors.UserReview, { format: review() }),
  prompt(actors.Acceptance, { format: acceptance() })
);
