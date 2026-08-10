import { schema } from "@forge/core/schema/effect";
import * as Schema from "effect/Schema";

const Risk = Schema.Literals(["critical", "high", "medium", "low"]);
const Complexity = Schema.Literals(["complex", "standard", "trivial"]);
const ArtifactReference = Schema.Struct({
  kind: Schema.Literals(["file", "commit", "spec", "test", "report"]),
  ref: Schema.String,
});

const ReviewHistory = Schema.Array(
  Schema.Struct({
    outcome: Schema.Literals(["approved", "changesRequested"]),
    notes: Schema.String,
    attempt: Schema.Number,
  })
);

const Decisions = Schema.Array(Schema.Struct({ question: Schema.String, answer: Schema.String }));

// --- Assignments: what the resolver hands to each capability -----------------

const AssignmentBase = Schema.Struct({
  objective: Schema.String,
  artifacts: Schema.Array(ArtifactReference),
});

const VerificationAssignmentBase = Schema.Struct({
  ...AssignmentBase.fields,
  acceptanceCriteria: Schema.Array(Schema.String),
});

export const ReviewAssignment = Schema.Struct({
  ...VerificationAssignmentBase.fields,
  for: Schema.Literal("reviewer"),
  focusAreas: Schema.Array(Schema.String),
});

export const VerificationAssignment = Schema.Struct({
  ...VerificationAssignmentBase.fields,
  for: Schema.Literal("verifier"),
  scenarios: Schema.Array(Schema.String),
  exclusions: Schema.Array(Schema.String),
});

export const ImplementationAssignment = Schema.Struct({
  ...VerificationAssignmentBase.fields,
  for: Schema.Literal("implementer"),
  scope: Schema.Array(Schema.String),
  constraints: Schema.Array(Schema.String),
});

export const RefineAssignment = Schema.Struct({
  ...AssignmentBase.fields,
  for: Schema.Literal("refiner"),
  focusAreas: Schema.Array(Schema.String),
  findings: Schema.Array(Schema.String),
  exclusions: Schema.Array(Schema.String),
});

/**
 * The resolver's decision. Each outcome is either a commitment routed through
 * the spend gate, or an authority boundary: a question, an escalation, or
 * abandonment.
 */
export type Resolution = Schema.Schema.Type<typeof Resolution>;
export const Resolution = Schema.Union([
  Schema.Struct({ ...ImplementationAssignment.fields, outcome: Schema.Literal("implement") }),
  Schema.Struct({ ...ReviewAssignment.fields, outcome: Schema.Literal("review") }),
  Schema.Struct({ ...VerificationAssignment.fields, outcome: Schema.Literal("verify") }),
  Schema.Struct({ ...RefineAssignment.fields, outcome: Schema.Literal("refine") }),
  Schema.Struct({
    outcome: Schema.Literal("ask-user"),
    question: Schema.String,
    options: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    outcome: Schema.Literal("escalate"),
    summary: Schema.String,
    diff: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ outcome: Schema.Literal("abandoned"), reason: Schema.String }),
]);

// --- Machine context ---------------------------------------------------------

const ContextStruct = Schema.Struct({
  input: Schema.Struct({
    prompt: Schema.String,
    files: Schema.Array(ArtifactReference),
  }),
  risk: Schema.optional(Risk),
  complexity: Schema.optional(Complexity),
  resolution: Schema.optional(Resolution),
  spend: Schema.Number,
  spendBudget: Schema.Number,
  reviewHistory: ReviewHistory,
  decisions: Decisions,
});

export type Context = Schema.Schema.Type<typeof ContextStruct>;
export const Context = schema(ContextStruct);

export const TaskAggregate = Schema.Struct({ attempts: Schema.Number });

// --- Task contracts ----------------------------------------------------------

const TaskReport = Schema.Struct({
  summary: Schema.String,
  artifacts: Schema.Array(ArtifactReference),
});

export const PlanRequest = Schema.Struct({
  prompt: Schema.String,
  files: Schema.Array(ArtifactReference),
  decisions: Decisions,
});

export const Plan = Schema.Struct({
  outcome: Schema.Literal("planned"),
  risk: Risk,
  complexity: Complexity,
});

export const ResolutionRequest = Schema.Struct({
  prompt: Schema.String,
  risk: Schema.optional(Risk),
  complexity: Schema.optional(Complexity),
  reviewHistory: ReviewHistory,
  decisions: Decisions,
});

export const ImplementationOutput = Schema.Struct({
  ...TaskReport.fields,
  outcome: Schema.Literal("implemented"),
});

export const ReviewOutput = Schema.Struct({
  notes: Schema.String,
  outcome: Schema.Literals(["approved", "changesRequested"]),
});

export const VerificationOutput = Schema.Struct({
  notes: Schema.String,
  outcome: Schema.Literals(["passed", "incomplete", "failed", "escalate"]),
});

export const RefineOutput = Schema.Struct({
  ...TaskReport.fields,
  outcome: Schema.Literals(["refined", "contradiction"]),
});

export const StallCheckInput = Schema.Struct({
  reviewHistory: ReviewHistory,
});

export const StallCheckOutput = Schema.Struct({
  outcome: Schema.Literals(["stalled", "progressing"]),
  reason: Schema.optionalKey(Schema.String),
});

/** Which commitment the resolver accepted; the gate passes it through or halts. */
const Commitment = Schema.Literals(["implement", "review", "verify", "refine"]);

export const SpendCheckInput = Schema.Struct({
  spend: Schema.Number,
  spendBudget: Schema.Number,
  commitment: Commitment,
});

export const SpendCheckOutput = Schema.Struct({
  outcome: Schema.Literals(["implement", "review", "verify", "refine", "overBudget"]),
});

export const TriageInput = Schema.Struct({
  reviewHistory: ReviewHistory,
});

export const TriageOutput = Schema.Struct({
  outcome: Schema.Literals(["minor-fix", "wrong-approach", "ambiguous-spec", "escalate"]),
  reasoning: Schema.String,
});

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
