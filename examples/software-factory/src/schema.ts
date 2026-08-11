import { schema } from "@forge/core/schema/effect";
import { Effect } from "effect";
import * as Schema from "effect/Schema";

const Risk = Schema.Literals(["critical", "high", "medium", "low"]);
const Complexity = Schema.Literals(["complex", "standard", "trivial"]);
const ArtifactReference = Schema.Struct({
  kind: Schema.Literals(["file", "commit", "spec", "test", "report"]),
  ref: Schema.String,
});

// --- Work items --------------------------------------------------------------

/** One unit of deliverable work, as the planner specifies it. */
const PlannedItem = Schema.Struct({
  id: Schema.String,
  objective: Schema.String,
  acceptanceCriteria: Schema.Array(Schema.String),
  dependsOn: Schema.Array(Schema.String),
  complexity: Complexity,
  risk: Risk,
});

/** A planned item once it is on the backlog, tracking delivery state. */
const Item = Schema.Struct({
  ...PlannedItem.fields,
  status: Schema.Literals(["pending", "integrated", "deferred"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("pending"))
  ),
});

// --- Backlog queries --------------------------------------------------------

/** Items whose review floor is the deterministic quality gate. */
export function gateTier(item: Item): boolean {
  return item.complexity === "trivial" && item.risk === "low";
}

/** Pending items whose dependencies are all integrated — workable right now. */
export function readyItems(backlog: readonly Item[]): Item[] {
  const integrated = new Set(
    backlog.filter((item) => item.status === "integrated").map((item) => item.id)
  );
  return backlog.filter(
    (item) => item.status === "pending" && item.dependsOn.every((dep) => integrated.has(dep))
  );
}

/**
 * Pending items that can never become ready: something in their transitive
 * dependencies is deferred or missing. Deferral cascades — a parked item
 * parks its dependents — which is what lets a partial delivery terminate
 * instead of waiting forever on unreachable work.
 */
export function unreachableItems(backlog: readonly Item[]): Set<string> {
  const byId = new Map(backlog.map((item) => [item.id, item]));
  const blocked = new Set<string>();

  const isBlocked = (id: string, trail: Set<string>): boolean => {
    const item = byId.get(id);
    if (item === undefined || item.status === "deferred") return true;
    if (item.status === "integrated") return false;
    if (blocked.has(id)) return true;
    if (trail.has(id)) return false; // cycles are inconsistency, not deferral
    trail.add(id);
    return item.dependsOn.some((dep) => isBlocked(dep, trail));
  };

  for (const item of backlog) {
    if (item.status === "pending" && isBlocked(item.id, new Set())) blocked.add(item.id);
  }

  return blocked;
}

const ReviewHistory = Schema.Array(
  Schema.Struct({
    itemId: Schema.String,
    outcome: Schema.Literals(["approved", "changesRequested"]),
    notes: Schema.String,
    attempt: Schema.Finite,
  })
);

const Decisions = Schema.Array(Schema.Struct({ question: Schema.String, answer: Schema.String }));

// --- Machine context ---------------------------------------------------------

const ContextStruct = Schema.Struct({
  input: Schema.Struct({
    prompt: Schema.String,
    files: Schema.Array(ArtifactReference).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  }),
  backlog: Schema.Array(Item).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  planVersion: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  /** The item currently on the line, when one is in flight. */
  current: Schema.optional(Schema.String),
  /** Refine cycles consumed by the current item. */
  attempts: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  /** Risk points integrated since the last verification. */
  unverifiedRisk: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  /** Model-grade spend consumed by the current item. */
  itemSpend: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  /** Whether the current item has already been re-implemented from scratch. */
  reworked: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  /** Outstanding review findings against the current item. */
  findings: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  /** A question raised by a blocked worker, awaiting the user. */
  pendingQuestion: Schema.optional(Schema.String),
  spend: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  spendBudget: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(25))),
  decisions: Decisions.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  reviewHistory: ReviewHistory.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});

export type Context = Schema.Schema.Type<typeof ContextStruct>;
export const Context = schema(ContextStruct);

export type Item = Schema.Schema.Type<typeof Item>;
export type PlannedItem = Schema.Schema.Type<typeof PlannedItem>;
export type ImplementationOutput = Schema.Schema.Type<typeof ImplementationOutput>;
export type ReviewOutput = Schema.Schema.Type<typeof ReviewOutput>;
export type AcceptanceRequest = Schema.Schema.Type<typeof AcceptanceRequest>;
export type AcceptanceOutput = Schema.Schema.Type<typeof AcceptanceOutput>;

export const TaskAggregate = Schema.Struct({ attempts: Schema.Finite });

// --- Task contracts ----------------------------------------------------------

/**
 * Any working actor can surface friction: `blocked` raises a question to the
 * user; `contradiction` reports that the work as specified conflicts with the
 * plan and routes to triage. Ambient as outcomes, never scheduler discretion.
 */
const Blocked = Schema.Struct({ outcome: Schema.Literal("blocked"), question: Schema.String });
const Contradiction = Schema.Struct({
  outcome: Schema.Literal("contradiction"),
  reason: Schema.String,
});

export const PlanRequest = Schema.Struct({
  prompt: Schema.String,
  files: Schema.Array(ArtifactReference),
  decisions: Decisions,
  /** Non-empty on a replan; integrated items must be preserved. */
  backlog: Schema.Array(Item),
});

export const Plan = Schema.Struct({
  outcome: Schema.Literal("planned"),
  backlog: Schema.Array(PlannedItem),
});

export const SelectRequest = Schema.Struct({
  backlog: Schema.Array(Item),
});

export const Selection = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("selected"), itemId: Schema.String }),
  Schema.Struct({ outcome: Schema.Literal("exhausted") }),
  Schema.Struct({ outcome: Schema.Literal("inconsistent"), reason: Schema.String }),
]);

export const ImplementationAssignment = Schema.Struct({
  item: Item,
  decisions: Decisions,
});

export const ImplementationOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("implemented"),
    summary: Schema.String,
    artifacts: Schema.Array(ArtifactReference),
  }),
  Blocked,
  Contradiction,
]);

export const ReviewAssignment = Schema.Struct({
  item: Item,
  summary: Schema.String,
});

export const ReviewOutput = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("approved"), notes: Schema.String }),
  Schema.Struct({
    outcome: Schema.Literal("changesRequested"),
    findings: Schema.Array(Schema.String),
  }),
  Contradiction,
]);

export const RefineAssignment = Schema.Struct({
  item: Item,
  findings: Schema.Array(Schema.String),
});

export const RefineOutput = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("refined"), summary: Schema.String }),
  Blocked,
  Contradiction,
]);

export const IntegrationRequest = Schema.Struct({
  itemId: Schema.String,
});

export const IntegrationOutput = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("integrated") }),
  Schema.Struct({
    outcome: Schema.Literal("failed"),
    findings: Schema.Array(Schema.String),
  }),
]);

export const VerificationRequest = Schema.Struct({
  prompt: Schema.String,
  backlog: Schema.Array(Item),
});

export const VerificationOutput = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("passed"), notes: Schema.String }),
  Schema.Struct({ outcome: Schema.Literal("failed"), evidence: Schema.Array(Schema.String) }),
  Blocked,
]);

export const TriageRequest = Schema.Struct({
  backlog: Schema.Array(Item),
  current: Schema.optional(Schema.String),
  findings: Schema.Array(Schema.String),
  reviewHistory: ReviewHistory,
  decisions: Decisions,
  planVersion: Schema.Finite,
  spend: Schema.Finite,
  spendBudget: Schema.Finite,
});

export const TriageOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("fix-item"),
    revisedObjective: Schema.String,
    reasoning: Schema.String,
  }),
  Schema.Struct({
    outcome: Schema.Literal("split"),
    fragments: Schema.Array(PlannedItem),
    reasoning: Schema.String,
  }),
  Schema.Struct({ outcome: Schema.Literal("defer"), reason: Schema.String }),
  Schema.Struct({ outcome: Schema.Literal("replan"), reasoning: Schema.String }),
  Schema.Struct({ outcome: Schema.Literal("escalate"), summary: Schema.String }),
]);

export const AskUserQuestionInput = Schema.Struct({
  question: Schema.String,
  options: Schema.optional(Schema.Array(Schema.String)),
});

export const AskUserQuestionOutput = Schema.Struct({
  outcome: Schema.Literal("answered"),
  answer: Schema.String,
});

export const UserReviewInput = Schema.Struct({
  summary: Schema.String,
  diff: Schema.optionalKey(Schema.String),
});

export const UserReviewOutput = Schema.Struct({
  outcome: Schema.Literals(["continue", "defer", "abandon"]),
  notes: Schema.optionalKey(Schema.String),
});

export const AcceptanceRequest = Schema.Struct({
  summary: Schema.String,
  backlog: Schema.Array(Item),
});

export const AcceptanceOutput = Schema.Struct({
  outcome: Schema.Literals(["accepted", "rejected"]),
  notes: Schema.optionalKey(Schema.String),
});
