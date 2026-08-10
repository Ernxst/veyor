import { actor } from "@forge/core";
import { schema } from "@forge/core/schema/effect";
import * as Schema from "./schema.ts";

export const Planner = actor("planner", {
  input: schema(Schema.PlanRequest),
  output: schema(Schema.Plan),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Resolver = actor("resolver", {
  input: schema(Schema.ResolutionRequest),
  output: schema(Schema.Resolution),
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

export const Verifier = actor("verifier", {
  input: schema(Schema.VerificationAssignment),
  output: schema(Schema.VerificationOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Refiner = actor("refiner", {
  input: schema(Schema.RefineAssignment),
  output: schema(Schema.RefineOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const StallDetector = actor("stallDetector", {
  input: schema(Schema.StallCheckInput),
  output: schema(Schema.StallCheckOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const SpendGuard = actor("spendGuard", {
  input: schema(Schema.SpendCheckInput),
  output: schema(Schema.SpendCheckOutput),
  aggregate: schema(Schema.TaskAggregate),
  context: Schema.Context,
});

export const Triage = actor("triage", {
  input: schema(Schema.TriageInput),
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
