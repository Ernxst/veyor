import { actor } from "@forge/core";
import { schema } from "@forge/core/schema/effect";
import * as Schema from "./schema.ts";

export const Planner = actor("planner", {
  input: schema(Schema.PlanRequest),
  output: schema(Schema.Plan),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const PlanAdopter = actor("planAdopter", {
  input: schema(Schema.PlanRequest),
  output: schema(Schema.Plan),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Selector = actor("selector", {
  input: schema(Schema.SelectRequest),
  output: schema(Schema.Selection),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const TrivialImplementer = actor("trivialImplementer", {
  input: schema(Schema.ImplementationAssignment),
  output: schema(Schema.ImplementationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Implementer = actor("implementer", {
  input: schema(Schema.ImplementationAssignment),
  output: schema(Schema.ImplementationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const SeniorImplementer = actor("seniorImplementer", {
  input: schema(Schema.ImplementationAssignment),
  output: schema(Schema.ImplementationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const GateReviewer = actor("gateReviewer", {
  input: schema(Schema.ReviewAssignment),
  output: schema(Schema.ReviewOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Reviewer = actor("reviewer", {
  input: schema(Schema.ReviewAssignment),
  output: schema(Schema.ReviewOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const AdversarialReviewer = actor("adversarialReviewer", {
  input: schema(Schema.ReviewAssignment),
  output: schema(Schema.ReviewOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Refiner = actor("refiner", {
  input: schema(Schema.RefineAssignment),
  output: schema(Schema.RefineOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Integrator = actor("integrator", {
  input: schema(Schema.IntegrationRequest),
  output: schema(Schema.IntegrationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const GateVerifier = actor("gateVerifier", {
  input: schema(Schema.VerificationRequest),
  output: schema(Schema.VerificationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Verifier = actor("verifier", {
  input: schema(Schema.VerificationRequest),
  output: schema(Schema.VerificationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Triage = actor("triage", {
  input: schema(Schema.TriageRequest),
  output: schema(Schema.TriageOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const AskUserQuestion = actor("askUserQuestion", {
  input: schema(Schema.AskUserQuestionInput),
  output: schema(Schema.AskUserQuestionOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const UserReview = actor("userReview", {
  input: schema(Schema.UserReviewInput),
  output: schema(Schema.UserReviewOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const AutoAcceptance = actor("autoAcceptance", {
  input: schema(Schema.AcceptanceRequest),
  output: schema(Schema.AcceptanceOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Acceptance = actor("acceptance", {
  input: schema(Schema.AcceptanceRequest),
  output: schema(Schema.AcceptanceOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});
