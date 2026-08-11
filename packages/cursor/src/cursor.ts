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

export interface CursorOptions {
  readonly instructions?: string;
  readonly cwd?: string;
  /** Absolute wall-clock bound; on expiry the child is killed and the run rejects. */
  readonly ceilingMs?: number;
}

export class CursorExecutionError extends Data.TaggedError("CursorExecutionError")<{
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

export class CursorJsonError extends Data.TaggedError("CursorJsonError")<{
  readonly cause: unknown;
}> {}

export class CursorValidationError extends Data.TaggedError("CursorValidationError")<{
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}> {}

export class CursorCeilingError extends Data.TaggedError("CursorCeilingError")<{
  readonly ceilingMs: number;
  readonly message: string;
}> {}

/**
 * Runs a Veyor actor through the local `cursor-agent` CLI in non-interactive
 * print mode (`cursor-agent -p`). Like opencode, cursor-agent has no
 * schema-enforced output mode, so the contract is stated in the prompt and
 * enforced by validation on return — a failure throws, and the machine's
 * retry policy re-invokes the worker.
 *
 * Based on `cursor-agent --help` and https://cursor.com/docs/cli — auth
 * could not be live-verified in the environment this adapter was built in
 * (see the `cursor-adapter-gotchas` skill for exactly what is docs-derived
 * vs empirically confirmed).
 */
function cursorImpl<A extends Actor.Any>(
  actor: A,
  model: string,
  options: CursorOptions = {}
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

        const args = buildCursorArgs(model, options, prompt);

        // The prompt is passed as a CLI argument, not via stdin — close
        // stdin explicitly so cursor-agent never blocks waiting for piped
        // context (its docs show `git diff | agent -p "..."` merging piped
        // stdin into the run, which would hang an inherited-open pipe).
        const handle = yield* spawner.spawn(
          ChildProcess.make("cursor-agent", args, { cwd: options.cwd, stdin: "ignore" })
        );

        // --output-format stream-json emits one JSON event per line
        // (assistant/tool_call/result) as the run progresses, rather than
        // buffering until completion — narrate it live and let the
        // terminal `result` event supply the canonical final text below.
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
          return yield* new CursorExecutionError({ exitCode, stderr });
        }

        const raw = yield* JsonParse(extractJson(narrator.finalText())).pipe(
          Effect.mapError((cause) => new CursorJsonError({ cause }))
        );

        const result = yield* Effect.tryPromise({
          try: () => Promise.resolve(output["~standard"].validate(raw)),
          catch: (cause) => new CursorJsonError({ cause }),
        });

        if (result.issues === undefined) return result.value;
        return yield* new CursorValidationError({ issues: result.issues });
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
                    new CursorCeilingError({
                      ceilingMs,
                      message: `cursor-agent run exceeded ceiling of ${ceilingMs}ms`,
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

/** A `cursor.preset` configuration: {@link CursorOptions} plus the model it captures. */
export interface CursorPreset extends CursorOptions {
  readonly model: string;
}

/**
 * Captures invariant worker configuration (model, cwd, ...) once, returning a
 * constructor for per-actor use:
 *
 * ```ts
 * const worker = cursor.preset({ model: "sonnet-4-thinking", cwd: workspace });
 * const ImplementerImpl = worker(Implementer, { instructions: "..." });
 * ```
 *
 * Per-call options shallow-merge over the preset, with per-call winning — including `model`, which
 * `cursor()` otherwise takes as a separate positional parameter. Sugar over {@link cursor}; no
 * logic is duplicated.
 */
function cursorPresetImpl(preset: CursorPreset) {
  const { model: presetModel, ...presetOptions } = preset;
  return function worker<A extends Actor.Any>(
    actor: A,
    options: Partial<CursorPreset> = {}
  ): Actor.ImplementationOf<A> {
    const { model = presetModel, ...rest } = options;
    return cursorImpl(actor, model, { ...presetOptions, ...rest });
  };
}

/** The callable signature of {@link cursor} together with its {@link cursor.preset} method. */
export interface CursorWorker {
  <A extends Actor.Any>(
    actor: A,
    model: string,
    options?: CursorOptions
  ): Actor.ImplementationOf<A>;
  readonly preset: (
    preset: CursorPreset
  ) => <A extends Actor.Any>(
    actor: A,
    options?: Partial<CursorPreset>
  ) => Actor.ImplementationOf<A>;
}

export const cursor: CursorWorker = Object.assign(cursorImpl, {
  preset: cursorPresetImpl,
});

function buildCursorArgs(model: string, options: CursorOptions, prompt: string): string[] {
  const flags: readonly (readonly [flag: string, value: string | undefined])[] = [
    // --help documents --workspace as defaulting to the process cwd; it is
    // passed explicitly (in addition to the spawn's own cwd) as the
    // sanctioned confinement flag since this could not be verified against
    // an authenticated run — see the cursor-adapter-gotchas skill.
    ["--workspace", options.cwd],
  ];

  return [
    "-p",
    // stream-json gives line-delimited progress events for narration; the
    // terminal `result` event's `result` field is the documented canonical
    // full response text, so --stream-partial-output (whose delta events
    // have multiple undocumented forms) is deliberately not used.
    "--output-format",
    "stream-json",
    // Headless runs have no TTY to answer tool-approval prompts; --force
    // is the documented flag for unattended scripts to avoid an actor task
    // hanging on an approval that can never arrive.
    "--force",
    "--model",
    model,
    ...flags.flatMap(([flag, value]) => (value === undefined ? [] : [flag, value])),
    prompt,
  ];
}

/** Loosely-typed shape of a `cursor-agent --output-format stream-json` event line. */
interface CursorEvent {
  readonly type: string;
  readonly subtype?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
  };
  readonly tool_call?: Readonly<Record<string, unknown>>;
  readonly result?: string;
  readonly duration_ms?: number;
}

function isCursorEvent(value: unknown): value is CursorEvent {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value)) return false;
  return typeof value.type === "string";
}

/** Parses one line of `--output-format stream-json` NDJSON output; malformed lines are dropped. */
function parseEvent(line: string): CursorEvent | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isCursorEvent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parses and dispatches one `--output-format stream-json` NDJSON line to the narrator. */
function onStdoutLine(line: string, onEvent: (event: CursorEvent) => void): void {
  const event = parseEvent(line);
  if (event !== undefined) onEvent(event);
}

function isAssistantTextEvent(event: CursorEvent): event is CursorEvent & {
  readonly message: { readonly content: ReadonlyArray<{ readonly text?: string }> };
} {
  return event.type === "assistant" && Array.isArray(event.message?.content);
}

function isToolCallEvent(
  event: CursorEvent
): event is CursorEvent & { readonly tool_call: Readonly<Record<string, unknown>> } {
  return (
    event.type === "tool_call" && event.subtype === "started" && typeof event.tool_call === "object"
  );
}

function isResultEvent(event: CursorEvent): event is CursorEvent & { readonly result: string } {
  return event.type === "result" && typeof event.result === "string";
}

/** Concatenates the text parts of an `assistant` event's `message.content` array. */
function assistantText(content: ReadonlyArray<{ readonly text?: string }>): string {
  return content
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

/** Derives a short label like `read` from a `tool_call` payload's `readToolCall` key. */
function toolLabel(toolCall: Readonly<Record<string, unknown>>): string {
  const key = Object.keys(toolCall)[0];
  if (key === undefined) return "tool";
  return key.endsWith("ToolCall") ? key.slice(0, -"ToolCall".length) : key;
}

function textPreview(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

const TEXT_REPORT_THROTTLE_NANOS = 1_000_000_000n; // ~1/sec

/**
 * Narrates `--output-format stream-json` events to `task.report` (tool
 * events always, text events throttled) and separately tracks the
 * canonical final text — the terminal `result` event's `result` field,
 * falling back to accumulated `assistant` text if the stream is cut short
 * (e.g. by the ceiling timeout or an aborted task.signal).
 */
function createNarrator(
  report: ((detail: string, data?: unknown) => void) | undefined,
  clock: Clock.Clock
): { readonly finalText: () => string; readonly onEvent: (event: CursorEvent) => void } {
  const textParts: string[] = [];
  let resultText: string | undefined;
  let lastTextReportAtNanos = 0n;

  const onAssistantText = (event: CursorEvent, text: string): void => {
    if (text === "") return;
    textParts.push(text);
    if (report === undefined) return;
    const now = clock.monotonicTimeNanosUnsafe();
    if (now - lastTextReportAtNanos < TEXT_REPORT_THROTTLE_NANOS) return;
    lastTextReportAtNanos = now;
    report(`text: ${textPreview(text)}`, event);
  };

  const onEvent = (event: CursorEvent): void => {
    if (isToolCallEvent(event)) {
      report?.(`tool: ${toolLabel(event.tool_call)}`, event);
      return;
    }
    if (isAssistantTextEvent(event)) {
      onAssistantText(event, assistantText(event.message.content));
      return;
    }
    if (isResultEvent(event)) {
      resultText = event.result;
      report?.(`result: ${event.duration_ms ?? "?"}ms`, event);
    }
  };

  return { finalText: () => resultText ?? textParts.join(""), onEvent };
}

/** Best-effort extraction of the response's JSON object from free-form output. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate;
}
