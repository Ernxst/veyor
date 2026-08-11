// @effect-diagnostics-next-line nodeBuiltinImport:off -- record/resume persistence is the runtime edge
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { textObserver, type Machine } from "@veyorhq/core";
import { Console, Effect, Option, type Cause, type Result } from "effect";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { blueprintOf, type Assembly, type VeyorConfig } from "../config.ts";
import { buildArgs, UsageError, type BuiltArg } from "../lift.ts";
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
      quiet: Flag.boolean("quiet").pipe(
        Flag.withDescription("Hide worker activity narration; show only station events"),
        Flag.optional
      ),
      record: Flag.string("record").pipe(
        Flag.withDescription(
          "Persist the run as an NDJSON record at this path, for later --resume"
        ),
        Flag.optional
      ),
      resume: Flag.string("resume").pipe(
        Flag.withDescription("Resume a crashed/partial run from a record file written by --record"),
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

    const resumePath = flagValue(input.resume);
    if (typeof resumePath === "string") {
      return yield* handleResume({ config, machine, input, resolved, resumePath });
    }

    const context = yield* decodeContext(machine, built, input, flagValue(input.context));
    if (context === undefined) return;

    yield* runAndReport(config, machine, input, { resolved, context, replay: undefined });
  });
}

function handleResume(target: {
  readonly config: VeyorConfig;
  readonly machine: Machine.Any;
  readonly input: RunInput;
  readonly resolved: { name: string; assembly: Assembly };
  readonly resumePath: string;
}): Effect.Effect<void> {
  const { config, machine, input, resolved, resumePath } = target;
  return Effect.gen(function* () {
    const record = readRecord(resumePath);
    if (Schema.is(UsageError)(record)) return yield* usageFail([record.message]);
    if (record.machineId !== machine.id) {
      return yield* usageFail([
        `--resume ${resumePath}: record is for machine "${record.machineId}", ` +
          `but this command runs "${machine.id}".`,
      ]);
    }

    yield* runAndReport(config, machine, input, {
      resolved,
      context: record.context,
      replay: record.events,
    });
  });
}

function runAndReport(
  config: VeyorConfig,
  machine: Machine.Any,
  input: RunInput,
  target: {
    readonly resolved: { name: string; assembly: Assembly };
    readonly context: unknown;
    readonly replay: readonly Machine.RunEvent[] | undefined;
  }
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { resolved, context, replay } = target;
    const impl = implOf(resolved.assembly, input.seed);
    const jsonMode = flagValue(input.json) === true;
    const recordPath = flagValue(input.record);
    const observer =
      typeof recordPath === "string"
        ? teeToRecord(recordPath, machine, context, observerOf(input.json, input.quiet))
        : observerOf(input.json, input.quiet);
    const tracked = withHeartbeat(jsonMode, observer);

    yield* emitHeader(jsonMode, machine, resolved.name, input.seed);

    const startedAt = performance.now();
    const outcome = yield* runImpl(impl, context, tracked, replay);
    const durationMs = performance.now() - startedAt;

    yield* emitFooterAndFinish(config, jsonMode, durationMs, outcome);
  });
}

function emitHeader(
  jsonMode: boolean,
  machine: Machine.Any,
  assemblyName: string,
  seedFlag: Option.Option<unknown> | undefined
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (!jsonMode) yield* Console.error(headerLine(machine, assemblyName, seedFlag));
  });
}

function runImpl(
  impl: Machine.Impl<Machine.Any>,
  context: unknown,
  tracked: Tracked,
  replay: readonly Machine.RunEvent[] | undefined
): Effect.Effect<Result.Result<Machine.Result<unknown, string>, Cause.UnknownError>> {
  const options: Machine.RunOptions =
    replay === undefined ? { observer: tracked.observer } : { observer: tracked.observer, replay };
  return Effect.result(
    Effect.tryPromise((): Promise<Machine.Result<unknown, string>> =>
      impl.run(context, options)
    ).pipe(Effect.ensuring(Effect.sync(() => tracked.stop())))
  );
}

function emitFooterAndFinish(
  config: VeyorConfig,
  jsonMode: boolean,
  durationMs: number,
  outcome: Result.Result<Machine.Result<unknown, string>, Cause.UnknownError>
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (outcome._tag === "Failure") {
      if (!jsonMode) yield* Console.error(footerLine(durationMs));
      return yield* usageFail([`run failed: ${errorMessage(outcome.failure.cause)}`]);
    }

    if (!jsonMode) yield* Console.error(footerLine(durationMs, outcome.success.task));

    yield* report(config, outcome.success);
  });
}

/** `▶ <machine id> · assembly <name>[ · seed <n>]` — printed once before the run starts. */
function headerLine(
  machine: Machine.Any,
  assemblyName: string,
  seedFlag: Option.Option<unknown> | undefined
): string {
  const seed = flagValue(seedFlag);
  const seedPart = typeof seed === "number" ? ` · seed ${seed}` : "";
  return `▶ ${machine.id} · assembly ${assemblyName}${seedPart}`;
}

/** `■ <sink> in <duration>` on success, `■ failed in <duration>` on failure. */
function footerLine(durationMs: number, sink?: string): string {
  const outcome = sink === undefined ? "failed" : sink;
  return `■ ${outcome} in ${humanizeDuration(durationMs)}`;
}

/** e.g. `34s`, `2m14s`, `4m`. */
function humanizeDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}

const HEARTBEAT_SILENCE_MS = 60_000;
const HEARTBEAT_TICK_MS = 15_000;

interface Tracked {
  readonly observer: (event: Machine.RunEvent) => void;
  readonly stop: () => void;
}

/**
 * In `--json` mode the heartbeat never fires (per spec); everywhere else it
 * wraps the observer to track run progress for `startHeartbeat`.
 */
function withHeartbeat(jsonMode: boolean, observer: (event: Machine.RunEvent) => void): Tracked {
  if (jsonMode) return { observer, stop: () => {} };
  return startHeartbeat(observer);
}

/**
 * Wraps an observer to print a status line to stderr whenever the run has
 * gone quiet for 60s, repeating every further 60s of continued silence.
 * The interval MUST be stopped once the run settles — see `stop()`.
 */
function startHeartbeat(observer: (event: Machine.RunEvent) => void): Tracked {
  let lastEventAt = performance.now();
  let nextDueAt = lastEventAt + HEARTBEAT_SILENCE_MS;
  let invoke:
    | { readonly task: string; readonly actor: string; readonly startedAt: number }
    | undefined;

  // @effect-diagnostics-next-line globalTimers:off -- plain interval bounded by stop(), cleared on settle
  const interval = setInterval(() => {
    const now = performance.now();
    if (now < nextDueAt || invoke === undefined) return;
    const elapsedMs = now - invoke.startedAt;
    const quietMs = now - lastEventAt;
    // @effect-diagnostics-next-line globalConsole:off -- heartbeat status on stderr
    console.error(
      `  … ${invoke.task} · ${invoke.actor} still running ` +
        `(${humanizeDuration(elapsedMs)} elapsed, ${humanizeDuration(quietMs)} quiet)`
    );
    nextDueAt = now + HEARTBEAT_SILENCE_MS;
  }, HEARTBEAT_TICK_MS);

  return {
    observer: (event) => {
      const now = performance.now();
      lastEventAt = now;
      nextDueAt = now + HEARTBEAT_SILENCE_MS;
      if (event.type === "invoke")
        invoke = { task: event.task, actor: event.actor, startedAt: now };
      observer(event);
    },
    stop: () => clearInterval(interval),
  };
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
  jsonFlag: Option.Option<unknown> | undefined,
  quietFlag: Option.Option<unknown> | undefined
): (event: Machine.RunEvent) => void {
  const observer = flagValue(jsonFlag) === true ? ndjsonObserver : textObserver();
  if (flagValue(quietFlag) !== true) return observer;
  return (event) => {
    if (event.type !== "activity") observer(event);
  };
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
  // @effect-diagnostics-next-line globalConsole:off preferSchemaOverJson:off -- stderr sink at the runtime edge
  console.error(timestampedEventLine(event));
}

function toArray(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

/** A RunEvent as one JSON line, with an `at` epoch-ms field and errors serialized to messages. */
function timestampedEventLine(event: Machine.RunEvent): string {
  const serializable =
    event.type === "error" ? { ...event, error: errorMessage(event.error) } : event;
  const at = performance.timeOrigin + performance.now();
  return JSON.stringify({ ...serializable, at });
}

/**
 * Writes the record header synchronously before the run starts (the decoded
 * context, so a resume needs no other input), then returns an observer that
 * tees each event — appended synchronously, since crash safety is the point
 * of `--record` — while still forwarding to `base`.
 */
function teeToRecord(
  path: string,
  machine: Machine.Any,
  context: unknown,
  base: (event: Machine.RunEvent) => void
): (event: Machine.RunEvent) => void {
  const header = { type: "record" as const, machine: machine.id, context };
  writeFileSync(path, `${JSON.stringify(header)}\n`);
  return (event) => {
    appendFileSync(path, `${timestampedEventLine(event)}\n`);
    base(event);
  };
}

interface ParsedRecord {
  readonly machineId: string;
  readonly context: unknown;
  readonly events: readonly Machine.RunEvent[];
}

/** Reads and parses an NDJSON record written by `--record`, for `--resume`. */
function readRecord(path: string): ParsedRecord | UsageError {
  try {
    const text = readFileSync(path, "utf8");
    return parseRecord(path, text);
  } catch (error) {
    return new UsageError({ message: `--resume ${path}: ${errorMessage(error)}` });
  }
}

function parseRecord(path: string, text: string): ParsedRecord | UsageError {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const [headerLine, ...eventLines] = lines;
  if (headerLine === undefined) {
    return new UsageError({ message: `--resume ${path}: empty record file.` });
  }

  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- boundary parse, shape checked below
    const header = JSON.parse(headerLine) as {
      type?: unknown;
      machine?: unknown;
      context?: unknown;
    };
    if (header.type !== "record" || typeof header.machine !== "string") {
      return new UsageError({ message: `--resume ${path}: first line is not a record header.` });
    }
    const events = eventLines.map(
      (line) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- boundary parse of our own recorded events
        JSON.parse(line) as Machine.RunEvent
    );
    return { machineId: header.machine, context: header.context, events };
  } catch (error) {
    return new UsageError({ message: `--resume ${path}: ${errorMessage(error)}` });
  }
}
