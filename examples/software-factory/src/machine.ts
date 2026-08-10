import { assign, machine, sink, task, transition } from "@forge/core";
import * as actors from "./actors.ts";
import * as Schema from "./schema.ts";

/** How many refine cycles an item gets before its failure becomes triage evidence. */
const MAX_REFINE_ATTEMPTS = 3;

/** The item currently on the line; tasks inside the item pipeline require one. */
function currentItem(context: Schema.Context): Schema.Item {
  const item = context.backlog.find((candidate) => candidate.id === context.current);
  if (item === undefined) {
    throw new Error(`No backlog item is on the line (current: "${context.current}").`);
  }

  return item;
}

/** Every executed work step consumes one unit of the spend budget. */
function charge(context: Schema.Context): Schema.Context {
  return { ...context, spend: context.spend + 1 };
}

/** Park a blocked worker's question for the ask-user task. */
function raise(context: Schema.Context, question: string): Schema.Context {
  return { ...context, pendingQuestion: question };
}

export const DeliveryBlueprint = machine({
  id: "software-delivery-factory",
  initial: "plan",
  context: Schema.Context,
  retries: 3,
  tasks: [
    // Terminals
    sink("done"),
    sink("abandoned"),

    // Planning produces the backlog. A replan amends it: integrated items are
    // preserved, pending ones are replaced by the revised plan. A caller that
    // supplies a backlog up front — typically another agent — gets it adopted
    // for free; the model planner only runs when there is planning to do.
    task(
      "plan",
      assign(actors.PlanAdopter, {
        when: ({ context }) => context.planVersion === 0 && context.backlog.length > 0,
        ...planHooks({ metered: false }),
      }),
      assign(actors.Planner, {
        when: ({ context }) => context.planVersion > 0 || context.backlog.length === 0,
        ...planHooks({ metered: true }),
      })
    ),

    // Selection is deterministic: the next pending item whose dependencies are
    // integrated. No model call — judgment is reserved for judgment.
    task(
      "select",
      assign(actors.Selector, {
        input: (context) => ({ backlog: context.backlog }),
        update: ({ context, output }) =>
          output.outcome === "selected"
            ? { ...context, current: output.itemId, attempts: 0, findings: [] }
            : context,
      })
    ),

    // The item pipeline. Harder items and repeated failure escalate to more
    // capable workers; any worker can raise a question or a contradiction.
    task(
      "implement",
      assign(actors.TrivialImplementer, {
        when: ({ context }) => currentItem(context).complexity === "trivial",
        ...implementationHooks(),
      }),
      assign(actors.Implementer, {
        when: ({ context, meta }) =>
          currentItem(context).complexity === "standard" && meta.retryCount <= 2,
        ...implementationHooks(),
      }),
      assign(actors.SeniorImplementer, {
        when: ({ context, meta }) =>
          currentItem(context).complexity === "complex" || meta.retryCount > 2,
        ...implementationHooks(),
      })
    ),

    // Review is unconditional after implementation — the quality floor is a
    // property of the graph, not a scheduling decision. What scales with the
    // stakes is the reviewer: trivial low-risk items get the deterministic
    // quality gate (unmetered), standard items a light model, high-risk items
    // an adversarial cross-vendor review.
    task(
      "review",
      assign(actors.GateReviewer, {
        when: ({ context }) => gateTier(currentItem(context)),
        ...reviewHooks({ metered: false }),
      }),
      assign(actors.Reviewer, {
        when: ({ context }) =>
          !gateTier(currentItem(context)) && currentItem(context).risk !== "high",
        ...reviewHooks({ metered: true }),
      }),
      assign(actors.AdversarialReviewer, {
        when: ({ context }) => currentItem(context).risk === "high",
        ...reviewHooks({ metered: true }),
      })
    ),

    task(
      "refine",
      assign(actors.Refiner, {
        input: (context) => ({ item: currentItem(context), findings: context.findings }),
        update: ({ context, output }) =>
          output.outcome === "blocked" ? raise(charge(context), output.question) : charge(context),
      })
    ),

    // Integration marks the item delivered and frees the line.
    task(
      "integrate",
      assign(actors.Integrator, {
        input: (context) => ({ itemId: currentItem(context).id }),
        update: ({ context }) => {
          const { current: _delivered, ...rest } = context;
          return {
            ...rest,
            backlog: context.backlog.map((item) =>
              item.id === context.current ? { ...item, status: "integrated" as const } : item
            ),
            findings: [],
            attempts: 0,
          };
        },
      })
    ),

    // Verification runs once, when the backlog is exhausted. Its floor is the
    // quality gate: a delivery whose every item was gate-reviewed is gate-verified.
    task(
      "verify",
      assign(actors.GateVerifier, {
        when: ({ context }) => context.backlog.every(gateTier),
        input: (context) => ({ prompt: context.input.prompt, backlog: context.backlog }),
      }),
      assign(actors.Verifier, {
        when: ({ context }) => !context.backlog.every(gateTier),
        input: (context) => ({ prompt: context.input.prompt, backlog: context.backlog }),
        update: ({ context, output }) =>
          output.outcome === "blocked" ? raise(charge(context), output.question) : charge(context),
      })
    ),

    // Triage classifies accumulated failure evidence: fix one item, replan,
    // or hand the run to the user.
    task(
      "triage",
      assign(actors.Triage, {
        input: (context) => ({
          backlog: context.backlog,
          current: context.current,
          findings: context.findings,
          reviewHistory: context.reviewHistory,
          decisions: context.decisions,
          planVersion: context.planVersion,
          spend: context.spend,
          spendBudget: context.spendBudget,
        }),
        update: ({ context, output }) =>
          output.outcome === "fix-item"
            ? {
                ...context,
                backlog: context.backlog.map((item) =>
                  item.id === context.current
                    ? { ...item, objective: output.revisedObjective }
                    : item
                ),
                attempts: 0,
                findings: [],
              }
            : context,
      })
    ),

    // HITL: answers become durable decisions every later task can read.
    task(
      "ask-user",
      assign(actors.AskUserQuestion, {
        input: (context) => ({
          question:
            context.pendingQuestion ??
            `The plan for "${context.input.prompt}" is ambiguous. How should the factory proceed?`,
        }),
        update: ({ context, input, output }) => {
          const { pendingQuestion: _answered, ...rest } = context;
          return {
            ...rest,
            decisions: [...context.decisions, { question: input.question, answer: output.answer }],
          };
        },
      })
    ),
    task(
      "user-review",
      assign(actors.UserReview, {
        input: (context) => ({
          summary: `Spent ${context.spend} of ${context.spendBudget} on "${context.input.prompt}"; ${
            context.backlog.filter((item) => item.status === "integrated").length
          } of ${context.backlog.length} items integrated. Continue?`,
        }),
        // Continuing past an exhausted budget authorises another tranche;
        // without it the budget guard would bounce the run straight back here.
        update: ({ context, output }) =>
          output.outcome === "continue" && context.spend >= context.spendBudget
            ? { ...context, spendBudget: context.spend + 10 }
            : context,
      })
    ),

    // Acceptance is the authority boundary at the end of the line — held by a
    // terminal human, a calling agent, or policy, depending on the assembly.
    // A fully gate-tier delivery that passed verification self-accepts.
    task(
      "accept",
      assign(actors.AutoAcceptance, {
        when: ({ context }) => context.backlog.every(gateTier),
        input: acceptanceInput,
      }),
      assign(actors.Acceptance, {
        when: ({ context }) => !context.backlog.every(gateTier),
        input: acceptanceInput,
      })
    ),
  ],
  transitions: [
    transition("plan", "select", { on: "planned" }),

    // The budget gate is an edge, not a station: starting new work requires
    // remaining budget, otherwise the user decides whether to fund more.
    transition("select", "implement", {
      on: "selected",
      when: (context: Schema.Context) => context.spend < context.spendBudget,
    }),
    transition("select", "user-review", { on: "selected" }),
    transition("select", "verify", { on: "exhausted" }),
    transition("select", "triage", { on: "inconsistent" }),

    transition("implement", "review", { on: "implemented" }),
    transition("implement", "ask-user", { on: "blocked" }),
    transition("implement", "triage", { on: "contradiction" }),

    // The refine loop is bounded by the machine: endless review is
    // unrepresentable, exhaustion becomes triage evidence.
    transition("review", "integrate", { on: "approved" }),
    transition("review", "refine", {
      on: "changesRequested",
      when: (context: Schema.Context) => context.attempts < MAX_REFINE_ATTEMPTS,
    }),
    transition("review", "triage", { on: "changesRequested" }),
    transition("review", "triage", { on: "contradiction" }),

    transition("refine", "review", { on: "refined" }),
    transition("refine", "ask-user", { on: "blocked" }),
    transition("refine", "triage", { on: "contradiction" }),

    transition("integrate", "select", { on: "integrated" }),

    transition("verify", "accept", { on: "passed" }),
    transition("verify", "triage", { on: "failed" }),
    transition("verify", "ask-user", { on: "blocked" }),

    transition("triage", "select", { on: "fix-item" }),
    transition("triage", "plan", { on: "replan" }),
    transition("triage", "user-review", { on: "escalate" }),

    transition("ask-user", "select", { on: "answered" }),
    transition("user-review", "select", { on: "continue" }),
    transition("user-review", "abandoned", { on: "abandon" }),

    transition("accept", "done", { on: "accepted" }),
    transition("accept", "triage", { on: "rejected" }),
  ],
});

function implementationHooks() {
  return {
    input: (context: Schema.Context) => ({
      item: currentItem(context),
      decisions: context.decisions,
    }),
    update: ({
      context,
      output,
    }: {
      context: Schema.Context;
      output: Schema.ImplementationOutput;
    }) =>
      output.outcome === "blocked" ? raise(charge(context), output.question) : charge(context),
  };
}

/** Items whose review floor is the deterministic quality gate. */
function gateTier(item: Schema.Item): boolean {
  return item.complexity === "trivial" && item.risk === "low";
}

function acceptanceInput(context: Schema.Context) {
  return {
    summary: `All ${context.backlog.length} backlog items are integrated and verification passed for "${context.input.prompt}".`,
    backlog: context.backlog,
  };
}

/** Spend meters model-grade work; adopting a caller-supplied backlog is free. */
function planHooks({ metered }: { metered: boolean }) {
  return {
    input: (context: Schema.Context) => ({
      prompt: context.input.prompt,
      files: context.input.files,
      decisions: context.decisions,
      backlog: context.backlog,
    }),
    update: ({
      context,
      output,
    }: {
      context: Schema.Context;
      output: { outcome: "planned"; backlog: readonly Schema.PlannedItem[] };
    }) => {
      const integrated = context.backlog.filter((item) => item.status === "integrated");
      const keep = new Set(integrated.map((item) => item.id));
      const planned = output.backlog
        .filter((item) => !keep.has(item.id))
        .map((item) => ({ ...item, status: "pending" as const }));

      const {
        current: _offline,
        pendingQuestion: _parked,
        ...rest
      } = metered ? charge(context) : context;
      return {
        ...rest,
        backlog: [...integrated, ...planned],
        planVersion: context.planVersion + 1,
        attempts: 0,
        findings: [],
      };
    },
  };
}

/** Spend meters model-grade work; a deterministic gate review is free. */
function reviewHooks({ metered }: { metered: boolean }) {
  return {
    input: (context: Schema.Context) => {
      const item = currentItem(context);
      return { item, summary: `Work delivered for "${item.objective}"` };
    },
    update: ({ context, output }: { context: Schema.Context; output: Schema.ReviewOutput }) => {
      const charged = metered ? charge(context) : context;
      if (output.outcome === "approved") {
        return {
          ...charged,
          reviewHistory: [
            ...context.reviewHistory,
            {
              itemId: currentItem(context).id,
              outcome: "approved" as const,
              notes: output.notes,
              attempt: context.attempts + 1,
            },
          ],
        };
      }

      if (output.outcome === "changesRequested") {
        return {
          ...charged,
          attempts: context.attempts + 1,
          findings: output.findings,
          reviewHistory: [
            ...context.reviewHistory,
            {
              itemId: currentItem(context).id,
              outcome: "changesRequested" as const,
              notes: output.findings.join("; "),
              attempt: context.attempts + 1,
            },
          ],
        };
      }

      return charged;
    },
  };
}
