import { assign, machine, sink, task, transition } from "@forge/core";
import * as actors from "./actors.ts";
import * as Schema from "./schema.ts";

type Commitment = Extract<
  Schema.Resolution,
  { outcome: "implement" | "review" | "verify" | "refine" }
>;

/** The accepted resolution, narrowed to the commitment a task expects. */
function accepted<Outcome extends Commitment["outcome"]>(
  context: Schema.Context,
  outcome: Outcome
): Extract<Schema.Resolution, { outcome: Outcome }> {
  const resolution = context.resolution;
  if (resolution?.outcome !== outcome) {
    throw new Error(`The accepted resolution is "${resolution?.outcome}", not "${outcome}".`);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the outcome check
  return resolution as Extract<Schema.Resolution, { outcome: Outcome }>;
}

/** Every executed commitment consumes one unit of the spend budget. */
function charge<Step extends { context: Schema.Context }>({ context }: Step): Schema.Context {
  return { ...context, spend: context.spend + 1 };
}

export const MySoftwareFactoryBlueprint = machine({
  id: "my-software-factory",
  initial: "plan",
  context: Schema.Context,
  retries: 3,
  tasks: [
    // Terminals
    sink("done"),
    sink("abandoned"),

    // Planning establishes or repairs the model. A new plan resets the
    // resolution and the rejection streak: the old approach no longer counts.
    task(
      "plan",
      assign(actors.Planner, {
        input: (context) => ({
          prompt: context.input.prompt,
          files: context.input.files,
          decisions: context.decisions,
        }),
        update: ({ context, output }) => {
          const { resolution: _replaced, ...rest } = context;
          return { ...rest, risk: output.risk, complexity: output.complexity, reviewHistory: [] };
        },
      })
    ),

    // Resolution selects exactly one next commitment and records it.
    task(
      "resolve",
      assign(actors.Resolver, {
        input: (context) => ({
          prompt: context.input.prompt,
          risk: context.risk,
          complexity: context.complexity,
          reviewHistory: context.reviewHistory,
          decisions: context.decisions,
        }),
        update: ({ context, output }) => ({ ...context, resolution: output }),
      })
    ),

    // The spend gate passes the accepted commitment through, or halts the run
    // for a human once the budget is exhausted.
    task(
      "spend-check",
      assign(actors.SpendGuard, {
        input: (context) => {
          const resolution = context.resolution;
          if (
            resolution === undefined ||
            resolution.outcome === "ask-user" ||
            resolution.outcome === "escalate" ||
            resolution.outcome === "abandoned"
          ) {
            throw new Error("The spend gate requires an accepted commitment.");
          }

          return {
            spend: context.spend,
            spendBudget: context.spendBudget,
            commitment: resolution.outcome,
          };
        },
      })
    ),

    // Escalate harder problems or repeated failures into more capable actors.
    task(
      "implement",
      assign(actors.TrivialImplementer, {
        when: ({ context }) => context.complexity === "trivial",
        input: (context) => accepted(context, "implement"),
        update: charge,
      }),
      assign(actors.Implementer, {
        when: ({ context, meta }) => context.complexity === "standard" && meta.retryCount <= 2,
        input: (context) => accepted(context, "implement"),
        update: charge,
      }),
      assign(actors.SeniorImplementer, {
        when: ({ context, meta }) => context.complexity === "complex" || meta.retryCount > 2,
        input: (context) => accepted(context, "implement"),
        update: charge,
      })
    ),

    // Reviews append to the history the stall detector and sticky simulations read.
    task(
      "review",
      assign(actors.Reviewer, {
        when: ({ context }) => context.risk !== "high",
        input: (context) => accepted(context, "review"),
        update: ({ context, output }) => ({
          ...charge({ context }),
          reviewHistory: [
            ...context.reviewHistory,
            {
              outcome: output.outcome,
              notes: output.notes,
              attempt: context.reviewHistory.length + 1,
            },
          ],
        }),
      }),
      assign(actors.AdversarialReviewer, {
        when: ({ context }) => context.risk === "high",
        input: (context) => accepted(context, "review"),
        update: ({ context, output }) => ({
          ...charge({ context }),
          reviewHistory: [
            ...context.reviewHistory,
            {
              outcome: output.outcome,
              notes: output.notes,
              attempt: context.reviewHistory.length + 1,
            },
          ],
        }),
      })
    ),

    // Verification independently certifies completion.
    task(
      "verify",
      assign(actors.Verifier, {
        input: (context) => accepted(context, "verify"),
        update: charge,
      })
    ),

    // Refinement applies accepted findings; triage sends it work directly, so
    // its assignment falls back to the review findings when no refine
    // commitment is on record.
    task(
      "refine",
      assign(actors.Refiner, {
        input: (context) =>
          context.resolution?.outcome === "refine"
            ? context.resolution
            : {
                for: "refiner" as const,
                objective: context.input.prompt,
                artifacts: context.input.files,
                focusAreas: [],
                findings: context.reviewHistory
                  .filter((review) => review.outcome === "changesRequested")
                  .map((review) => review.notes),
                exclusions: [],
              },
        update: charge,
      })
    ),

    // Circuit-breakers
    task(
      "stall-check",
      assign(actors.StallDetector, {
        input: (context) => ({ reviewHistory: context.reviewHistory }),
      })
    ),

    // Self-healing/correction
    task(
      "triage",
      assign(actors.Triage, {
        input: (context) => ({ reviewHistory: context.reviewHistory }),
      })
    ),

    // HITL: answers become durable decisions later planning and resolution can read.
    task(
      "ask-user-question",
      assign(actors.AskUserQuestion, {
        input: (context) =>
          context.resolution?.outcome === "ask-user"
            ? { question: context.resolution.question, options: context.resolution.options }
            : {
                question: `The specification for "${context.input.prompt}" is ambiguous. How should the factory proceed?`,
              },
        update: ({ context, input, output }) => ({
          ...context,
          decisions: [...context.decisions, { question: input.question, answer: output.answer }],
        }),
      })
    ),
    task(
      "user-review",
      assign(actors.UserReview, {
        input: (context) => {
          if (context.resolution?.outcome === "escalate") {
            const { outcome: _escalate, ...request } = context.resolution;
            return request;
          }

          return {
            summary: `Spent ${context.spend} of ${context.spendBudget} on "${context.input.prompt}" over ${context.reviewHistory.length} reviews. Continue?`,
          };
        },
      })
    ),
  ],
  transitions: [
    transition("plan", "resolve", { on: "planned" }),

    // Every new commitment crosses the spend gate. Authority boundaries go
    // directly to a human.
    transition("resolve", "spend-check", { on: "implement" }),
    transition("resolve", "spend-check", { on: "review" }),
    transition("resolve", "spend-check", { on: "verify" }),
    transition("resolve", "spend-check", { on: "refine" }),
    transition("resolve", "ask-user-question", { on: "ask-user" }),
    transition("resolve", "user-review", { on: "escalate" }),
    transition("resolve", "abandoned", { on: "abandoned" }),

    // An accepted commitment is executed by exactly one capability.
    transition("spend-check", "implement", { on: "implement" }),
    transition("spend-check", "review", { on: "review" }),
    transition("spend-check", "verify", { on: "verify" }),
    transition("spend-check", "refine", { on: "refine" }),
    transition("spend-check", "user-review", { on: "overBudget" }),

    // Material results are checked for progress before another commitment begins.
    transition("implement", "stall-check", { on: "implemented" }),
    transition("review", "stall-check", { on: "approved" }),
    transition("review", "stall-check", { on: "changesRequested" }),
    transition("refine", "stall-check", { on: "refined" }),
    transition("refine", "triage", { on: "contradiction" }),
    transition("stall-check", "resolve", { on: "progressing" }),
    transition("stall-check", "triage", { on: "stalled" }),

    // Triage reopens the earliest decision invalidated by the contradiction.
    transition("triage", "refine", { on: "minor-fix" }),
    transition("triage", "plan", { on: "wrong-approach" }),
    transition("triage", "ask-user-question", { on: "ambiguous-spec" }),
    transition("triage", "user-review", { on: "escalate" }),

    // Human answers feed resolution; a human review may end the run.
    transition("ask-user-question", "resolve", { on: "answered" }),
    transition("user-review", "resolve", { on: "continue" }),
    transition("user-review", "abandoned", { on: "abandon" }),

    // Verification certifies completion or reopens the earliest affected decision.
    transition("verify", "done", { on: "passed" }),
    transition("verify", "resolve", { on: "incomplete" }),
    transition("verify", "triage", { on: "failed" }),
    transition("verify", "user-review", { on: "escalate" }),
  ],
});
