import type { Machine } from "@veyorhq/core";
import { Console, Effect, Option, type Cause, type Result } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { blueprintOf, soleSeededName, type Assembly, type VeyorConfig } from "../config.ts";
import { kindAt, propertyNames, type Kind } from "../jsonschema.ts";
import { buildArgs, type BuiltArg } from "../lift.ts";
import { decodeContext, errorMessage, resolveAssembly, usageFail } from "./common.ts";

export function makeSimulate(config: VeyorConfig) {
  const machine = blueprintOf(config);
  const jsonSchema = machine.contract.Context["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  });
  const built = buildArgs(config, jsonSchema);
  const numericFields = propertyNames(jsonSchema).filter((name) =>
    isNumericKind(kindAt(jsonSchema, [name]))
  );
  const setup: SimulateSetup = { config, machine, built, numericFields };

  return Command.make(
    "simulate",
    {
      ...Object.fromEntries(built.map((arg) => [arg.id, arg.param])),
      assembly: Flag.choice("assembly", Object.keys(config.assemblies)).pipe(
        Flag.withDescription("Worker assembly to simulate"),
        Flag.optional
      ),
      context: Flag.fileParse("context").pipe(
        Flag.withDescription("Base context file; declared args override its fields"),
        Flag.optional
      ),
      runs: Flag.integer("runs").pipe(
        Flag.withDescription("Number of runs"),
        Flag.withDefault(1000)
      ),
      seed: Flag.integer("seed").pipe(
        Flag.withDescription("Base seed; run i uses seed + i"),
        Flag.withDefault(0)
      ),
    },
    (input) => handler(setup, input)
  ).pipe(Command.withDescription("Run the factory many times and tally where it lands"));
}

function isNumericKind(kind: Kind): boolean {
  return kind === "number" || kind === "integer";
}

interface SimulateSetup {
  readonly config: VeyorConfig;
  readonly machine: Machine.Any;
  readonly built: readonly BuiltArg[];
  readonly numericFields: readonly string[];
}

interface SimulateInput {
  readonly [key: string]: Option.Option<unknown> | number;
}

function handler(setup: SimulateSetup, input: SimulateInput): Effect.Effect<void> {
  const { config, machine, built, numericFields } = setup;
  return Effect.gen(function* () {
    // Defaulting to run's assembly would fire real workers; the seeded one is the
    // only safe implicit choice, and only when it is unambiguous.
    const resolved = resolveAssembly(config, asOption(input.assembly), soleSeededName(config));
    if (resolved instanceof Error) return yield* usageFail([resolved.message]);

    const values = Object.fromEntries(built.map((arg) => [arg.id, asOption(input[arg.id])]));
    const context = yield* decodeContext(
      machine,
      built,
      values,
      Option.getOrUndefined(asOption(input.context))
    );
    if (context === undefined) return;

    const runs = asNumber(input.runs, 1000);
    const seed = asNumber(input.seed, 0);

    const outcomes = yield* Effect.forEach(
      Array.from({ length: runs }, (_, i) => seed + i),
      (runSeed) =>
        Effect.result(
          Effect.tryPromise((): Promise<Machine.Result<unknown, string>> =>
            implFor(resolved.assembly, runSeed).run(context)
          )
        )
    );

    const summary = summarize(resolved.name, runs, outcomes, numericFields);
    // @effect-diagnostics-next-line preferSchemaOverJson:off -- untyped boundary output, pretty-printed
    yield* Console.log(JSON.stringify(summary, null, 2));
  });
}

type RunOutcome = Result.Result<Machine.Result<unknown, string>, Cause.UnknownError>;

function summarize(
  assembly: string,
  runs: number,
  outcomes: readonly RunOutcome[],
  numericFields: readonly string[]
) {
  const sinks = new Map<string, number>();
  const failures = new Map<string, number>();
  for (const outcome of outcomes) tally(outcome, sinks, failures);

  const context = summarizeContext(outcomes, numericFields);

  return {
    assembly,
    runs,
    sinks: Object.fromEntries(
      [...sinks].map(([task, count]) => [task, { count, share: share(count, runs) }])
    ),
    failures: Object.fromEntries(failures),
    ...(context === undefined ? {} : { context }),
  };
}

interface FieldStats {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
}

/** Mean/min/max per numeric context field across successful runs, omitting empty fields. */
function summarizeContext(
  outcomes: readonly RunOutcome[],
  numericFields: readonly string[]
): Record<string, FieldStats> | undefined {
  if (numericFields.length === 0) return undefined;

  const values = new Map<string, number[]>(numericFields.map((field) => [field, []]));
  for (const outcome of outcomes) collectContextValues(outcome, numericFields, values);

  const stats = Object.fromEntries(
    [...values].flatMap(([field, samples]) => {
      const fieldStats = statsOf(samples);
      return fieldStats === undefined ? [] : [[field, fieldStats]];
    })
  );

  return Object.keys(stats).length === 0 ? undefined : stats;
}

function collectContextValues(
  outcome: RunOutcome,
  numericFields: readonly string[],
  values: Map<string, number[]>
): void {
  const record = contextRecordOf(outcome);
  if (record === undefined) return;
  for (const field of numericFields) pushNumeric(values, field, record[field]);
}

function contextRecordOf(outcome: RunOutcome): Readonly<Record<string, unknown>> | undefined {
  if (outcome._tag !== "Success") return undefined;
  return isRecord(outcome.success.context) ? outcome.success.context : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function pushNumeric(values: Map<string, number[]>, field: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) values.get(field)?.push(value);
}

function statsOf(samples: readonly number[]): FieldStats | undefined {
  if (samples.length === 0) return undefined;
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    mean: Math.round((sum / samples.length) * 1000) / 1000,
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

function tally(
  outcome: RunOutcome,
  sinks: Map<string, number>,
  failures: Map<string, number>
): void {
  if (outcome._tag === "Success") bump(sinks, outcome.success.task);
  else bump(failures, errorMessage(outcome.failure.cause));
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function implFor(assembly: Assembly, seed: number): Machine.Impl<Machine.Any> {
  return typeof assembly === "function" ? assembly(seed) : assembly;
}

function asOption(value: Option.Option<unknown> | number | undefined): Option.Option<unknown> {
  return value === undefined || typeof value === "number" ? Option.none() : value;
}

function asNumber(value: Option.Option<unknown> | number | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function share(count: number, runs: number): number {
  return Math.round((count / runs) * 1000) / 1000;
}
