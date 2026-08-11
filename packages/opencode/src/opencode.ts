import { NodeServices } from "@effect/platform-node";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Actor } from "@veyorhq/core";
import { getJsonSchema } from "@veyorhq/core/schema";
import { JsonParse, JsonStringify } from "@veyorhq/core/schema/effect";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export interface OpencodeOptions {
  readonly instructions?: string;
  readonly cwd?: string;
  /** A named opencode agent configuration to run under. */
  readonly agent?: string;
  /** Absolute wall-clock bound; on expiry the child is killed and the run rejects. */
  readonly ceilingMs?: number;
}

export class OpencodeExecutionError extends Data.TaggedError("OpencodeExecutionError")<{
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

export class OpencodeJsonError extends Data.TaggedError("OpencodeJsonError")<{
  readonly cause: unknown;
}> {}

export class OpencodeValidationError extends Data.TaggedError("OpencodeValidationError")<{
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}> {}

export class OpencodeCeilingError extends Data.TaggedError("OpencodeCeilingError")<{
  readonly ceilingMs: number;
  readonly message: string;
}> {}

/**
 * Runs a Veyor actor through the local opencode CLI in non-interactive mode
 * (`opencode run`). opencode has no schema-enforced output, so the contract
 * is stated in the prompt and enforced by validation — a failure throws, and
 * the machine's retry policy re-invokes the worker.
 * Based on https://opencode.ai/docs/cli/
 */
export function opencode<A extends Actor.Any>(
  actor: A,
  model: string,
  options: OpencodeOptions = {}
): Actor.ImplementationOf<A> {
  const output = actor.contract.Output;
  const json = getJsonSchema(output);

  return {
    ...actor,
    run(task) {
      const program = Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const clock = yield* Clock.Clock;

        const jsonSchema = json["~standard"].jsonSchema.output({ target: "draft-07" });
        const schema = yield* JsonStringify(jsonSchema);
        const input = yield* JsonStringify(task);
        const prompt = [
          options.instructions,
          "Complete the following assignment.",
          input,
          "Respond with ONLY a single JSON object that validates against this JSON Schema — no prose, no markdown fences:",
          schema,
        ]
          .filter(Boolean)
          .join("\n\n");

        const args = buildOpencodeArgs(model, options, prompt);

        // opencode merges piped stdin into the prompt and waits for EOF, so
        // an open stdin pipe would hang the run — close it explicitly.
        const handle = yield* spawner.spawn(
          ChildProcess.make("opencode", args, { cwd: options.cwd, stdin: "ignore" })
        );

        // --format json emits one JSON event per line as the run progresses
        // (step/tool/text events) rather than buffering formatted output —
        // narrate it live and collect the assistant's text parts for the
        // final contract extraction below.
        const narrator = createNarrator(task.report, clock);

        const [, stderr, exitCode] = yield* Effect.all(
          [
            handle.stdout.pipe(
              Stream.decodeText,
              Stream.splitLines,
              Stream.runForEach((line) => Effect.sync(() => onStdoutLine(line, narrator.onEvent)))
            ),
            handle.stderr.pipe(Stream.decodeText, Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: "unbounded" }
        );

        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new OpencodeExecutionError({ exitCode, stderr });
        }

        const raw = yield* JsonParse(extractJson(narrator.textParts.join(""))).pipe(
          Effect.mapError((cause) => new OpencodeJsonError({ cause }))
        );

        const result = yield* Effect.tryPromise({
          try: () => Promise.resolve(output["~standard"].validate(raw)),
          catch: (cause) => new OpencodeJsonError({ cause }),
        });

        if (result.issues === undefined) return result.value;
        return yield* new OpencodeValidationError({ issues: result.issues });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

      const ceilingMs = options.ceilingMs;
      const bounded =
        ceilingMs === undefined
          ? program
          : program.pipe(
              Effect.timeoutOrElse({
                duration: ceilingMs,
                orElse: () =>
                  Effect.fail(
                    new OpencodeCeilingError({
                      ceilingMs,
                      message: `opencode run exceeded ceiling of ${ceilingMs}ms`,
                    })
                  ),
              })
            );

      // The child is killed on scope finalization whenever this fiber is
      // interrupted — by `task.signal` aborting (below) or by the ceiling
      // timeout above interrupting the source effect.
      return Effect.runPromise(bounded, { signal: task.signal });
    },
  };
}

/** An `opencodePreset` configuration: {@link OpencodeOptions} plus the model it captures. */
export interface OpencodePreset extends OpencodeOptions {
  readonly model: string;
}

/**
 * Captures invariant worker configuration (model, cwd, agent, ...) once, returning a constructor
 * for per-actor use:
 *
 * ```ts
 * const worker = opencodePreset({ model: FREE, cwd: workspace });
 * const ImplementerImpl = worker(Implementer, { instructions: "..." });
 * ```
 *
 * Per-call options shallow-merge over the preset, with per-call winning — including `model`, which
 * `opencode()` otherwise takes as a separate positional parameter. Sugar over {@link opencode}; no
 * logic is duplicated.
 */
export function opencodePreset(preset: OpencodePreset) {
  const { model: presetModel, ...presetOptions } = preset;
  return function worker<A extends Actor.Any>(
    actor: A,
    options: Partial<OpencodePreset> = {}
  ): Actor.ImplementationOf<A> {
    const { model = presetModel, ...rest } = options;
    return opencode(actor, model, { ...presetOptions, ...rest });
  };
}

function buildOpencodeArgs(model: string, options: OpencodeOptions, prompt: string): string[] {
  const flags: readonly (readonly [flag: string, value: string | undefined])[] = [
    // opencode resolves its working directory itself and ignores the child
    // process cwd — --dir is the sanctioned way to confine it.
    ["--dir", options.cwd],
    ["--agent", options.agent],
  ];

  return [
    "run",
    "--model",
    model,
    // --format json streams one JSON event per line (step/tool/text) as the
    // run progresses, instead of buffering ANSI-formatted output — this is
    // what drives task.report narration below.
    "--format",
    "json",
    ...flags.flatMap(([flag, value]) => (value === undefined ? [] : [flag, value])),
    prompt,
  ];
}

/** Loosely-typed shape of an `opencode run --format json` event line. */
interface OpencodeEvent {
  readonly type: string;
  readonly part?: {
    readonly type?: string;
    readonly tool?: string;
    readonly title?: string;
    readonly text?: string;
    readonly tokens?: {
      readonly input?: number;
      readonly output?: number;
    };
  };
}

function isOpencodeEvent(value: unknown): value is OpencodeEvent {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value)) return false;
  return typeof value.type === "string";
}

/** Parses one line of `--format json` NDJSON output; malformed lines are dropped. */
function parseEvent(line: string): OpencodeEvent | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isOpencodeEvent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parses and dispatches one `--format json` NDJSON line to the narrator. */
function onStdoutLine(line: string, onEvent: (event: OpencodeEvent) => void): void {
  const event = parseEvent(line);
  if (event !== undefined) onEvent(event);
}

function isToolUseEvent(
  event: OpencodeEvent
): event is OpencodeEvent & { readonly part: { readonly tool: string } } {
  return (
    event.type === "tool_use" && event.part?.type === "tool" && typeof event.part.tool === "string"
  );
}

function isTextEvent(
  event: OpencodeEvent
): event is OpencodeEvent & { readonly part: { readonly text: string } } {
  return event.type === "text" && typeof event.part?.text === "string";
}

/** A `step_finish` event with token counts, e.g. from `opencode run --format json`. */
function isStepFinishEvent(event: OpencodeEvent): event is OpencodeEvent & {
  readonly part: { readonly tokens: { readonly input: number; readonly output: number } };
} {
  const tokens = event.part?.tokens;
  return (
    event.type === "step_finish" &&
    typeof tokens?.input === "number" &&
    typeof tokens.output === "number"
  );
}

function toolLabel(part: { readonly tool: string; readonly title?: string }): string {
  return typeof part.title === "string" && part.title.length > 0 ? part.title : part.tool;
}

function textPreview(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** Compact token-count formatting, e.g. `16459` -> `16.5k`. */
function formatTokenCount(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`;
}

const TEXT_REPORT_THROTTLE_NANOS = 1_000_000_000n; // ~1/sec

/**
 * Narrates `--format json` events to `task.report` (tool events always,
 * text events throttled) and separately collects every text part for the
 * final contract extraction.
 */
function createNarrator(
  report: ((detail: string, data?: unknown) => void) | undefined,
  clock: Clock.Clock
): { readonly textParts: string[]; readonly onEvent: (event: OpencodeEvent) => void } {
  const textParts: string[] = [];
  let lastTextReportAtNanos = 0n;

  const onText = (event: OpencodeEvent, text: string): void => {
    textParts.push(text);
    if (report === undefined) return;
    const now = clock.monotonicTimeNanosUnsafe();
    if (now - lastTextReportAtNanos < TEXT_REPORT_THROTTLE_NANOS) return;
    lastTextReportAtNanos = now;
    report(`text: ${textPreview(text)}`, event);
  };

  const onEvent = (event: OpencodeEvent): void => {
    if (isToolUseEvent(event)) {
      report?.(`tool: ${event.part.tool} (${toolLabel(event.part)})`, event);
      return;
    }
    if (isTextEvent(event)) {
      onText(event, event.part.text);
      return;
    }
    if (isStepFinishEvent(event)) {
      const { input, output } = event.part.tokens;
      report?.(
        `usage: ${formatTokenCount(input)} in / ${formatTokenCount(output)} out tokens`,
        event
      );
    }
  };

  return { textParts, onEvent };
}

/** Best-effort extraction of the response's JSON object from free-form output. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate;
}
