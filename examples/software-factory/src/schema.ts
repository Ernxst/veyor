import { schema } from "@forge/core/schema/effect";
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
  status: Schema.Literals(["pending", "integrated"]),
});

const ReviewHistory = Schema.Array(
  Schema.Struct({
    itemId: Schema.String,
    outcome: Schema.Literals(["approved", "changesRequested"]),
    notes: Schema.String,
    attempt: Schema.Number,
  })
);

const Decisions = Schema.Array(Schema.Struct({ question: Schema.String, answer: Schema.String }));

// --- Machine context ---------------------------------------------------------

const ContextStruct = Schema.Struct({
  input: Schema.Struct({
    prompt: Schema.String,
    files: Schema.Array(ArtifactReference),
  }),
  backlog: Schema.Array(Item),
  planVersion: Schema.Number,
  /** The item currently on the line, when one is in flight. */
  current: Schema.optional(Schema.String),
  /** Refine cycles consumed by the current item. */
  attempts: Schema.Number,
  /** Outstanding review findings against the current item. */
  findings: Schema.Array(Schema.String),
  /** A question raised by a blocked worker, awaiting the user. */
  pendingQuestion: Schema.optional(Schema.String),
  spend: Schema.Number,
  spendBudget: Schema.Number,
  decisions: Decisions,
  reviewHistory: ReviewHistory,
});

export type Context = Schema.Schema.Type<typeof ContextStruct>;
export const Context = schema(ContextStruct);

export type Item = Schema.Schema.Type<typeof Item>;
export type PlannedItem = Schema.Schema.Type<typeof PlannedItem>;
export type ImplementationOutput = Schema.Schema.Type<typeof ImplementationOutput>;
export type ReviewOutput = Schema.Schema.Type<typeof ReviewOutput>;
export type AcceptanceRequest = Schema.Schema.Type<typeof AcceptanceRequest>;
export type AcceptanceOutput = Schema.Schema.Type<typeof AcceptanceOutput>;

export const TaskAggregate = Schema.Struct({ attempts: Schema.Number });

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

export const IntegrationOutput = Schema.Struct({
  outcome: Schema.Literal("integrated"),
});

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
  planVersion: Schema.Number,
  spend: Schema.Number,
  spendBudget: Schema.Number,
});

export const TriageOutput = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal("fix-item"),
    revisedObjective: Schema.String,
    reasoning: Schema.String,
  }),
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
  outcome: Schema.Literals(["continue", "abandon"]),
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
