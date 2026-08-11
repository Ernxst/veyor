import type { Machine } from "@veyor/core";
import { Console, Effect, Option, type Cause, type Result } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { blueprintOf, soleSeededName, type Assembly, type VeyorConfig } from "../config.ts";
import { buildArgs, type BuiltArg } from "../lift.ts";
import { decodeContext, errorMessage, resolveAssembly, usageFail } from "./common.ts";

export function makeSimulate(config: VeyorConfig) {
  const machine = blueprintOf(config);
  const jsonSchema = machine.contract.Context["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  });
  const built = buildArgs(config, jsonSchema);

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
    (input) => handler(config, machine, built, input)
  ).pipe(Command.withDescription("Run the factory many times and tally where it lands"));
}

interface SimulateInput {
  readonly [key: string]: Option.Option<unknown> | number;
}

function handler(
  config: VeyorConfig,
  machine: Machine.Any,
  built: readonly BuiltArg[],
  input: SimulateInput
): Effect.Effect<void> {
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

    const summary = summarize(resolved.name, runs, outcomes);
    // @effect-diagnostics-next-line preferSchemaOverJson:off -- untyped boundary output, pretty-printed
    yield* Console.log(JSON.stringify(summary, null, 2));
  });
}

type RunOutcome = Result.Result<Machine.Result<unknown, string>, Cause.UnknownError>;

function summarize(assembly: string, runs: number, outcomes: readonly RunOutcome[]) {
  const sinks = new Map<string, number>();
  const failures = new Map<string, number>();
  for (const outcome of outcomes) tally(outcome, sinks, failures);

  return {
    assembly,
    runs,
    sinks: Object.fromEntries(
      [...sinks].map(([task, count]) => [task, { count, share: share(count, runs) }])
    ),
    failures: Object.fromEntries(failures),
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
