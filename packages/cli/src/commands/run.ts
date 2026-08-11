import { textObserver, type Machine } from "@veyorhq/core";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { blueprintOf, type Assembly, type VeyorConfig } from "../config.ts";
import { buildArgs, type BuiltArg } from "../lift.ts";
import { decodeContext, errorMessage, resolveAssembly, usageFail } from "./common.ts";

export function makeRun(config: VeyorConfig) {
  const machine = blueprintOf(config);
  const jsonSchema = machine.contract.Context["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  });
  const built = buildArgs(config, jsonSchema);

  const command = Command.make(
    "run",
    {
      ...Object.fromEntries(built.map((arg) => [arg.id, arg.param])),
      assembly: Flag.choice("assembly", Object.keys(config.assemblies)).pipe(
        Flag.withDescription("Worker assembly to run"),
        Flag.optional
      ),
      context: Flag.fileParse("context").pipe(
        Flag.withDescription("Base context file; declared args override its fields"),
        Flag.optional
      ),
      seed: Flag.integer("seed").pipe(
        Flag.withDescription("Seed, for assemblies that take one"),
        Flag.optional
      ),
      json: Flag.boolean("json").pipe(
        Flag.withDescription("Emit progress as NDJSON events instead of text"),
        Flag.optional
      ),
    },
    (input) => handler(config, machine, built, input)
  ).pipe(
    Command.withDescription("Assemble the initial context, run the factory, report the result")
  );

  return config.examples === undefined
    ? command
    : command.pipe(Command.withExamples(config.examples));
}

interface RunInput {
  readonly [key: string]: Option.Option<unknown>;
}

function handler(
  config: VeyorConfig,
  machine: Machine.Any,
  built: readonly BuiltArg[],
  input: RunInput
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const resolved = resolveAssembly(config, input.assembly ?? Option.none(), config.run?.assembly);
    if (resolved instanceof Error) return yield* usageFail([resolved.message]);

    const context = yield* decodeContext(machine, built, input, flagValue(input.context));
    if (context === undefined) return;

    const impl = implOf(resolved.assembly, input.seed);
    const observer = observerOf(input.json);
    const outcome = yield* Effect.result(
      Effect.tryPromise((): Promise<Machine.Result<unknown, string>> =>
        impl.run(context, { observer })
      )
    );
    if (outcome._tag === "Failure") {
      return yield* usageFail([`run failed: ${errorMessage(outcome.failure.cause)}`]);
    }

    yield* report(config, outcome.success);
  });
}

function flagValue(value: Option.Option<unknown> | undefined): unknown {
  return Option.getOrUndefined(value ?? Option.none());
}

function implOf(
  assembly: Assembly,
  seedFlag: Option.Option<unknown> | undefined
): Machine.Impl<Machine.Any> {
  if (typeof assembly !== "function") return assembly;
  const seed = flagValue(seedFlag);
  return assembly(typeof seed === "number" ? seed : 0);
}

function observerOf(
  jsonFlag: Option.Option<unknown> | undefined
): (event: Machine.RunEvent) => void {
  return flagValue(jsonFlag) === true ? ndjsonObserver : textObserver();
}

function report(config: VeyorConfig, result: Machine.Result<unknown, string>): Effect.Effect<void> {
  return Effect.gen(function* () {
    // @effect-diagnostics-next-line preferSchemaOverJson:off -- untyped boundary output, pretty-printed
    yield* Console.log(JSON.stringify({ task: result.task, context: result.context }, null, 2));

    const success = config.run?.success;
    if (success !== undefined && !toArray(success).includes(result.task)) {
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    }
  });
}

/** Progress for embedders: one JSON event per line on stderr. */
function ndjsonObserver(event: Machine.RunEvent): void {
  const serializable =
    event.type === "error" ? { ...event, error: errorMessage(event.error) } : event;
  // @effect-diagnostics-next-line globalConsole:off preferSchemaOverJson:off -- stderr sink at the runtime edge
  console.error(JSON.stringify(serializable));
}

function toArray(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}
