import { assign, machine, sink, task, transition } from "@veyor/core";
import * as actors from "./actors.ts";
import * as Schema from "./schema.ts";

/** How many refine cycles an item gets before its base is presumed wrong. */
const MAX_REFINE_ATTEMPTS = 3;

/**
 * Verification cadence tracks accumulated unverified semantic risk, not a
 * flat count: heavy items verify almost immediately, cheap ones batch. The
 * later a plan-level failure is discovered, the larger the forward
 * correction — this bounds that cost where it is most likely to bite.
 */
const VERIFY_RISK_BUDGET = 6;

/** How much unverified semantic risk integrating this item accrues. */
function riskPoints(item: Schema.Item): number {
  const complexity = { trivial: 1, standard: 2, complex: 3 }[item.complexity];
  const risky = item.risk === "high" || item.risk === "critical" ? 1 : 0;
  return complexity + risky;
}

/** How much model-grade spend one item may consume before it becomes triage evidence. */
function itemSpendCap(item: Schema.Item): number {
  return { trivial: 3, standard: 6, complex: 9 }[item.complexity];
}

/** The item currently on the line; tasks inside the item pipeline require one. */
function currentItem(context: Schema.Context): Schema.Item {
  const item = context.backlog.find((candidate) => candidate.id === context.current);
  if (item === undefined) {
    throw new Error(`No backlog item is on the line (current: "${context.current}").`);
  }

  return item;
}

/** Meter model-grade work against the run budget. */
function charge(context: Schema.Context): Schema.Context {
  return { ...context, spend: context.spend + 1 };
}

/** Item-pipeline work also meters against the current item's own bound. */
function chargeItem(context: Schema.Context): Schema.Context {
  return { ...charge(context), itemSpend: context.itemSpend + 1 };
}

/** Park a blocked worker's question for the ask-user task. */
function raise(context: Schema.Context, question: string): Schema.Context {
  return { ...context, pendingQuestion: question };
}

/** Park the current item; deferral cascades to its dependents at selection. */
function deferCurrent(context: Schema.Context): Schema.Context {
  if (context.current === undefined) return context;

  const { current: _parked, ...rest } = context;
  return {
    ...rest,
    backlog: context.backlog.map((item) =>
      item.id === context.current ? { ...item, status: "deferred" as const } : item
    ),
    attempts: 0,
    itemSpend: 0,
    reworked: false,
    findings: [],
  };
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
            ? {
                ...context,
                current: output.itemId,
                attempts: 0,
                itemSpend: 0,
                reworked: false,
                findings: [],
              }
            : context,
      })
    ),

    // The item pipeline. Harder items and repeated failure escalate to more
    // capable workers; a rework entry (refines exhausted) always lands on the
    // senior tier with a clean slate. Any worker can raise a question or a
    // contradiction.
    task(
      "implement",
      assign(actors.TrivialImplementer, {
        when: ({ context }) =>
          currentItem(context).complexity === "trivial" && !reworkEntry(context),
        ...implementationHooks(),
      }),
      assign(actors.Implementer, {
        when: ({ context, meta }) =>
          currentItem(context).complexity === "standard" &&
          meta.retryCount <= 2 &&
          !reworkEntry(context),
        ...implementationHooks(),
      }),
      assign(actors.SeniorImplementer, {
        when: ({ context, meta }) =>
          currentItem(context).complexity === "complex" ||
          meta.retryCount > 2 ||
          reworkEntry(context),
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
        when: ({ context }) => Schema.gateTier(currentItem(context)),
        ...reviewHooks({ metered: false }),
      }),
      assign(actors.Reviewer, {
        when: ({ context }) =>
          !Schema.gateTier(currentItem(context)) &&
          currentItem(context).risk !== "high" &&
          !context.reworked,
        ...reviewHooks({ metered: true }),
      }),
      // Review escalates on evidence like implementation does: an item that
      // needed a rework has proven it is hard, whatever its predicted risk.
      assign(actors.AdversarialReviewer, {
        when: ({ context }) => currentItem(context).risk === "high" || context.reworked,
        ...reviewHooks({ metered: true }),
      })
    ),

    task(
      "refine",
      assign(actors.Refiner, {
        input: (context) => ({ item: currentItem(context), findings: context.findings }),
        update: ({ context, output }) =>
          output.outcome === "blocked"
            ? raise(chargeItem(context), output.question)
            : chargeItem(context),
      })
    ),

    // Integration is the per-item mechanical gate: it certifies the whole
    // system still builds and passes checks with the item in place, so nothing
    // broken is ever stacked on. Failure surfaces at the offending item —
    // verification failures then attribute to the plan, not to archaeology.
    task(
      "integrate",
      assign(actors.Integrator, {
        input: (context) => ({ itemId: currentItem(context).id }),
        update: ({ context, output }) => {
          if (output.outcome === "failed") {
            return { ...context, findings: output.findings, attempts: context.attempts + 1 };
          }

          const { current: _delivered, ...rest } = context;
          return {
            ...rest,
            backlog: context.backlog.map((item) =>
              item.id === context.current ? { ...item, status: "integrated" as const } : item
            ),
            unverifiedRisk: context.unverifiedRisk + riskPoints(currentItem(context)),
            findings: [],
            attempts: 0,
            itemSpend: 0,
            reworked: false,
          };
        },
      })
    ),

    // Verification's floor is the quality gate: a delivery whose every item
    // was gate-reviewed is gate-verified. Milestone verifications surface
    // plan-level wrongness while replanning is still cheap.
    task(
      "verify",
      assign(actors.GateVerifier, {
        when: ({ context }) => context.backlog.every(Schema.gateTier),
        input: (context) => ({ prompt: context.input.prompt, backlog: context.backlog }),
        update: ({ context }) => ({ ...context, unverifiedRisk: 0 }),
      }),
      assign(actors.Verifier, {
        when: ({ context }) => !context.backlog.every(Schema.gateTier),
        input: (context) => ({ prompt: context.input.prompt, backlog: context.backlog }),
        update: ({ context, output }) =>
          output.outcome === "blocked"
            ? raise(charge(context), output.question)
            : { ...charge(context), unverifiedRisk: 0 },
      })
    ),

    // Triage classifies accumulated failure evidence: respec the item, split
    // it into smaller ones, park it, replan, or hand the run to the user.
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
        update: ({ context, output }) => {
          if (output.outcome === "fix-item") {
            return {
              ...context,
              backlog: context.backlog.map((item) =>
                item.id === context.current ? { ...item, objective: output.revisedObjective } : item
              ),
              attempts: 0,
              itemSpend: 0,
              reworked: false,
              findings: [],
            };
          }

          if (output.outcome === "split") return splitCurrent(context, output.fragments);
          if (output.outcome === "defer") return deferCurrent(context);
          return context;
        },
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
        input: (context) => {
          const integrated = context.backlog.filter((i) => i.status === "integrated").length;
          return {
            summary: `Spent ${context.spend} of ${context.spendBudget} on "${context.input.prompt}"; ${integrated} of ${context.backlog.length} items integrated. Continue, defer the current item, or abandon?`,
          };
        },
        // Continuing past an exhausted budget authorises another tranche;
        // deferring parks the current item and ships the rest.
        update: ({ context, output }) => {
          if (output.outcome === "defer") return deferCurrent(context);
          return output.outcome === "continue" && context.spend >= context.spendBudget
            ? { ...context, spendBudget: context.spend + 10 }
            : context;
        },
      })
    ),

    // Acceptance is the authority boundary at the end of the line — held by a
    // terminal human, a calling agent, or policy, depending on the assembly.
    // A fully gate-tier delivery that passed verification self-accepts.
    task(
      "accept",
      assign(actors.AutoAcceptance, {
        when: ({ context }) => context.backlog.every(Schema.gateTier),
        input: acceptanceInput,
      }),
      assign(actors.Acceptance, {
        when: ({ context }) => !context.backlog.every(Schema.gateTier),
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
    // Budget pressure gets autonomous scope surgery first — triage can defer
    // or split to fit — and reaches the user through escalation when the cut
    // needs authority (or more funding).
    transition("select", "triage", { on: "selected" }),
    transition("select", "verify", { on: "exhausted" }),
    transition("select", "triage", { on: "inconsistent" }),

    transition("implement", "review", { on: "implemented" }),
    transition("implement", "ask-user", { on: "blocked" }),
    transition("implement", "triage", { on: "contradiction" }),

    // Bounded refinement, then one rework from scratch at the senior tier,
    // then triage. The item's own spend bound cuts across both loops so a
    // sick item cannot starve the rest of the backlog.
    transition("review", "integrate", { on: "approved" }),
    transition("review", "refine", {
      on: "changesRequested",
      when: (context: Schema.Context) =>
        context.attempts < MAX_REFINE_ATTEMPTS &&
        context.itemSpend < itemSpendCap(currentItem(context)),
    }),
    transition("review", "implement", {
      on: "changesRequested",
      when: (context: Schema.Context) =>
        !context.reworked && context.itemSpend < itemSpendCap(currentItem(context)),
    }),
    transition("review", "triage", { on: "changesRequested" }),
    transition("review", "triage", { on: "contradiction" }),

    transition("refine", "review", { on: "refined" }),
    transition("refine", "ask-user", { on: "blocked" }),
    transition("refine", "triage", { on: "contradiction" }),

    // A failed integration feeds the same bounded repair loop as a failed review.
    transition("integrate", "refine", {
      on: "failed",
      when: (context: Schema.Context) =>
        context.attempts < MAX_REFINE_ATTEMPTS &&
        context.itemSpend < itemSpendCap(currentItem(context)),
    }),
    transition("integrate", "triage", { on: "failed" }),

    // Verify while replanning is still cheap, as soon as the accumulated
    // unverified risk spends its budget.
    transition("integrate", "verify", {
      on: "integrated",
      when: (context: Schema.Context) =>
        context.unverifiedRisk >= VERIFY_RISK_BUDGET &&
        Schema.readyItems(context.backlog).length > 0,
    }),
    transition("integrate", "select", { on: "integrated" }),

    // A passed milestone resumes the line; a passed final verification seeks
    // acceptance. Deferred-blocked items count as done-with-remainder, not work.
    transition("verify", "select", {
      on: "passed",
      when: (context: Schema.Context) => Schema.readyItems(context.backlog).length > 0,
    }),
    transition("verify", "accept", { on: "passed" }),
    transition("verify", "triage", { on: "failed" }),
    transition("verify", "ask-user", { on: "blocked" }),

    transition("triage", "select", { on: "fix-item" }),
    transition("triage", "select", { on: "split" }),
    transition("triage", "select", { on: "defer" }),
    transition("triage", "plan", { on: "replan" }),
    transition("triage", "user-review", { on: "escalate" }),

    transition("ask-user", "select", { on: "answered" }),
    transition("user-review", "select", { on: "continue" }),
    transition("user-review", "select", { on: "defer" }),
    transition("user-review", "abandoned", { on: "abandon" }),

    transition("accept", "done", { on: "accepted" }),
    transition("accept", "triage", { on: "rejected" }),
  ],
});

/** A rework entry: refines exhausted, base presumed wrong, start over senior. */
function reworkEntry(context: Schema.Context): boolean {
  return context.attempts >= MAX_REFINE_ATTEMPTS;
}

/**
 * Replace the current item with smaller fragments. The machine owns id and
 * dependency integrity — the last fragment inherits the original id so
 * dependents stay valid, and fragments chain in order — trusting triage only
 * for objectives and classification.
 */
function splitCurrent(
  context: Schema.Context,
  fragments: readonly Schema.PlannedItem[]
): Schema.Context {
  if (context.current === undefined || fragments.length === 0) return context;

  const original = currentItem(context);
  const chain = fragments.map((fragment, index) => ({
    ...fragment,
    id: index === fragments.length - 1 ? original.id : `${original.id}/${index + 1}`,
    dependsOn: index === 0 ? original.dependsOn : [`${original.id}/${index}`],
    status: "pending" as const,
  }));

  const { current: _split, ...rest } = context;
  return {
    ...rest,
    backlog: context.backlog.flatMap((item) => (item.id === original.id ? chain : [item])),
    attempts: 0,
    itemSpend: 0,
    reworked: false,
    findings: [],
  };
}

function acceptanceInput(context: Schema.Context) {
  const integrated = context.backlog.filter((item) => item.status === "integrated").length;
  const deferred = context.backlog.length - integrated;
  return {
    summary:
      deferred === 0
        ? `All ${context.backlog.length} backlog items are integrated and verification passed for "${context.input.prompt}".`
        : `${integrated} of ${context.backlog.length} backlog items are integrated (${deferred} deferred) and verification passed for "${context.input.prompt}".`,
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
        itemSpend: 0,
        reworked: false,
        findings: [],
      };
    },
  };
}

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
    }) => {
      const charged = chargeItem(context);
      // A rework entry starts from a clean slate at the senior tier.
      const based = reworkEntry(context)
        ? { ...charged, reworked: true, attempts: 0, findings: [] }
        : charged;
      return output.outcome === "blocked" ? raise(based, output.question) : based;
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
      const charged = metered ? chargeItem(context) : context;
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
