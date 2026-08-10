import { generate, type JsonSchema } from "json-schema-faker";
import { getJsonSchema } from "../lib/schema/index.ts";
import { validate } from "../lib/schema/validate.ts";
import type { Actor } from "../modules/actor.ts";
import type { Task } from "../modules/task.ts";

export type OutcomeWeights = Readonly<Record<string, number>>;

export interface ProbabilisticOptions<A extends Actor.Any = Actor.Any> {
  seed?: number;
  successRate?: number;
  failureRate?: number;
  /**
   * Weighted outcomes, or a function deriving them from the live task input —
   * use a function to model correlated failure, e.g. weights that read prior
   * rejections out of the machine context.
   */
  outcomes?:
    | OutcomeWeights
    | ((task: Task.Input<Actor.ContextOf<A>, Actor.InputOf<A>>) => OutcomeWeights);
}

export function probabilistic<A extends Actor.Any>(
  actor: A,
  options: ProbabilisticOptions<A> = {}
): Actor.ImplementationOf<A> {
  const rand = options.seed !== undefined ? mulberry32(options.seed) : Math.random;
  const output = actor.contract.Output;
  const json = getJsonSchema(output)["~standard"].jsonSchema.output({ target: "draft-2020-12" });

  return {
    ...actor,
    aggregate: () => Promise.resolve(),
    // @effect-diagnostics-next-line asyncFunction:off
    async run(task) {
      maybeFail(getFailureRate(options), rand, actor.name);
      const raw = await generateOutput(options, json, rand, task);

      return await validate(output, raw, "probabilistic output", actor.name);
    },
  };
}

function maybeFail(failureRate: number | undefined, rand: () => number, actorName: string): void {
  if (failureRate !== undefined && rand() < failureRate) {
    throw new Error(`Probabilistic actor "${actorName}" failed as configured.`);
  }
}

function getFailureRate<A extends Actor.Any>(options: ProbabilisticOptions<A>): number | undefined {
  if (options.failureRate !== undefined) return options.failureRate;
  if (options.successRate !== undefined) return 1 - options.successRate;
  return undefined;
}

// @effect-diagnostics-next-line asyncFunction:off
async function generateOutput<A extends Actor.Any>(
  options: ProbabilisticOptions<A>,
  json: JsonSchema,
  rand: () => number,
  task: Task.Input<Actor.ContextOf<A>, Actor.InputOf<A>>
): Promise<unknown> {
  const seed = perCallSeed(options.seed, rand);
  if (options.outcomes === undefined) return generate(json, seed);

  const weights =
    typeof options.outcomes === "function" ? options.outcomes(task) : options.outcomes;
  const outcome = pickWeighted(weights, rand);
  return withOutcome(await generate(constrainOutcome(json, outcome), seed), outcome);
}

/** A fresh seed per invocation keeps runs reproducible without repeating outputs. */
function perCallSeed(seed: number | undefined, rand: () => number): { seed?: number } {
  return seed === undefined ? {} : { seed: Math.floor(rand() * 2 ** 32) };
}

function withOutcome(generated: unknown, outcome: string): unknown {
  return typeof generated === "object" && generated !== null
    ? { ...generated, outcome }
    : generated;
}

/** Narrows a JSON schema so generation can only produce the picked outcome. */
function constrainOutcome(json: JsonSchema, outcome: string): JsonSchema {
  if (typeof json === "boolean") return json;

  const variants = json.anyOf ?? json.oneOf;
  if (Array.isArray(variants)) return constrainVariants(json, variants, outcome);
  return constrainProperty(json, outcome);
}

function constrainVariants(
  json: Exclude<JsonSchema, boolean>,
  variants: readonly JsonSchema[],
  outcome: string
): JsonSchema {
  const branches = variants.filter((branch) => allowsOutcome(branch, outcome));
  if (branches.length === 0) {
    throw new Error(`No branch of this output schema produces the outcome "${outcome}".`);
  }

  return { ...json, [json.anyOf !== undefined ? "anyOf" : "oneOf"]: branches };
}

function constrainProperty(json: Exclude<JsonSchema, boolean>, outcome: string): JsonSchema {
  const properties = json.properties;
  if (properties?.outcome === undefined) return json;
  return { ...json, properties: { ...properties, outcome: { const: outcome } } };
}

function allowsOutcome(branch: JsonSchema, outcome: string): boolean {
  if (typeof branch === "boolean") return true;

  const property = branch.properties?.outcome;
  if (property === undefined || typeof property === "boolean") return true;
  if (property.const !== undefined) return property.const === outcome;
  if (Array.isArray(property.enum)) return property.enum.includes(outcome);
  return true;
}

// seeded PRNG so runs are reproducible when `seed` is given
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(outcomes: OutcomeWeights, rand: () => number): string {
  const entries = Object.entries(outcomes);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);

  let roll = rand() * total;

  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }

  const last = entries.at(-1);
  if (last === undefined) throw new Error("Provide at least one probabilistic outcome.");
  return last[0];
}
