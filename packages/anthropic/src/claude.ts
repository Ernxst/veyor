import { NodeServices } from "@effect/platform-node";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Actor } from "@veyorhq/core";
import { getJsonSchema } from "@veyorhq/core/schema";
import { JsonParse, JsonStringify } from "@veyorhq/core/schema/effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export interface ClaudeOptions {
  readonly effort?: "low" | "medium" | "high" | "xhigh" | "max";
  readonly instructions?: string;
  readonly cwd?: string;
  readonly permissionMode?:
    | "acceptEdits"
    | "auto"
    | "bypassPermissions"
    | "manual"
    | "dontAsk"
    | "plan";
  readonly allowedTools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly maxBudgetUsd?: number;
  /** Absolute wall-clock bound on the worker; the child process is killed and the run rejects on expiry. */
  readonly ceilingMs?: number;
}

export class ClaudeExecutionError extends Data.TaggedError("ClaudeExecutionError")<{
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

export class ClaudeJsonError extends Data.TaggedError("ClaudeJsonError")<{
  readonly cause: unknown;
}> {}

export class ClaudeValidationError extends Data.TaggedError("ClaudeValidationError")<{
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}> {}

export class ClaudeCeilingError extends Data.TaggedError("ClaudeCeilingError")<{
  readonly actor: string;
  readonly ceilingMs: number;
  readonly message: string;
}> {}

/** The slice of Claude Code's `--output-format stream-json` result envelope this adapter reads. */
interface ResultEnvelope {
  readonly is_error?: boolean;
  readonly result?: unknown;
  readonly structured_output?: unknown;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly total_cost_usd?: number;
}

/** The slice of a `stream-json` JSONL event this adapter reads to narrate progress and find the final result. */
interface ClaudeStreamEvent extends ResultEnvelope {
  readonly type: string;
  readonly message?: {
    readonly content?: readonly ClaudeContentBlock[];
  };
}

/** Covers both `assistant` content blocks (tool_use/text) and `user` content blocks (tool_result). */
interface ClaudeContentBlock {
  readonly type: string;
  readonly name?: string;
  readonly text?: string;
  readonly input?: Record<string, unknown>;
  readonly content?: unknown;
  readonly is_error?: boolean;
}

const TEXT_REPORT_THROTTLE_MS = 1000;

function truncate(text: string, length: number): string {
  const trimmed = text.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

function toolDetail(input: Record<string, unknown> | undefined): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input.command === "string") return truncate(input.command, 120);
  if (typeof input.description === "string") return truncate(input.description, 120);
  if (typeof input.file_path === "string") return input.file_path;
  return undefined;
}

const EDIT_LIKE_TOOL_NAMES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

function describeToolUse(block: ClaudeContentBlock): string {
  const name = block.name ?? "tool";
  const filePath = typeof block.input?.file_path === "string" ? block.input.file_path : undefined;
  if (EDIT_LIKE_TOOL_NAMES.has(name) && filePath !== undefined) return `edit: ${filePath}`;

  const detail = toolDetail(block.input);
  return detail !== undefined ? `tool: ${name} (${detail})` : `tool: ${name}`;
}

function reportTextBlock(
  block: ClaudeContentBlock,
  report: (detail: string, data?: unknown) => void,
  throttle: { lastTextReportAt: number },
  now: number
): void {
  if (block.text === undefined || block.text === "") return;
  if (now - throttle.lastTextReportAt < TEXT_REPORT_THROTTLE_MS) return;
  throttle.lastTextReportAt = now;
  report(`text: ${truncate(block.text, 200)}`, block);
}

function reportContentBlock(
  block: ClaudeContentBlock,
  report: (detail: string, data?: unknown) => void,
  throttle: { lastTextReportAt: number },
  now: number
): void {
  if (block.type === "tool_use") report(describeToolUse(block), block);
  else if (block.type === "text") reportTextBlock(block, report, throttle, now);
}

function parseStreamEvent(line: string): ClaudeStreamEvent | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- event shapes are read defensively below
    return JSON.parse(trimmed) as ClaudeStreamEvent;
  } catch {
    return undefined;
  }
}

function reportAssistantEvent(
  event: ClaudeStreamEvent,
  report: (detail: string, data?: unknown) => void,
  throttle: { lastTextReportAt: number },
  now: number
): void {
  if (event.type !== "assistant") return;
  for (const block of event.message?.content ?? [])
    reportContentBlock(block, report, throttle, now);
}

/** Extracts the plain-text content of a `tool_result` block, whose `content` may be a string or an
 * array of content blocks (only `text` blocks are read). */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(blockText).join(" ");
}

/** Returns a `text` field's string value, or `""` for anything else (including non-object blocks). */
function blockText(block: unknown): string {
  if (block === null || typeof block !== "object" || !("text" in block)) return "";
  const { text } = block;
  return typeof text === "string" ? text : "";
}

/**
 * Reports a `user` event's `tool_result` block: a `tool failed: <reason>` line when it errored, or a
 * terse `tool done` otherwise — the corresponding `tool:`/`edit:` START line already carries the command,
 * so a successful result needs no further detail.
 */
function reportToolResultBlock(
  block: ClaudeContentBlock,
  report: (detail: string, data?: unknown) => void
): void {
  if (block.type !== "tool_result") return;
  const detail =
    block.is_error === true
      ? `tool failed: ${truncate(toolResultText(block.content), 120)}`
      : "tool done";
  report(detail, block);
}

function reportUserEvent(
  event: ClaudeStreamEvent,
  report: (detail: string, data?: unknown) => void
): void {
  if (event.type !== "user") return;
  for (const block of event.message?.content ?? []) reportToolResultBlock(block, report);
}

/**
 * Parses one JSONL line from `--output-format stream-json`, narrating tool use, tool results, and
 * (throttled) assistant text via `task.report`, and returns the event if it is the final `result` line.
 */
function processStreamLine(
  line: string,
  report: ((detail: string, data?: unknown) => void) | undefined,
  throttle: { lastTextReportAt: number },
  now: number
): ClaudeStreamEvent | undefined {
  const event = parseStreamEvent(line);
  if (event === undefined) return undefined;
  if (report !== undefined) {
    reportAssistantEvent(event, report, throttle, now);
    reportUserEvent(event, report);
  }
  return event.type === "result" ? event : undefined;
}

/**
 * Reads the current time and reports one `stream-json` line via `task.report`, returning the event if
 * it is the final `result` line.
 */
function reportStreamLine(
  line: string,
  report: ((detail: string, data?: unknown) => void) | undefined,
  throttle: { lastTextReportAt: number }
): Effect.Effect<ClaudeStreamEvent | undefined> {
  return Effect.clockWith((clock) =>
    Effect.sync(() => processStreamLine(line, report, throttle, clock.currentTimeMillisUnsafe()))
  );
}

function keepLast<A>(previous: A | undefined, next: A | undefined): A | undefined {
  return next ?? previous;
}

/**
 * Streams a spawned `claude` process's `stdout` as `stream-json` lines, narrating progress via
 * `task.report` as they arrive, and resolves to the final `result` event (if any).
 */
function streamResultEvent(
  stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  report: ((detail: string, data?: unknown) => void) | undefined
): Effect.Effect<ClaudeStreamEvent | undefined, PlatformError.PlatformError> {
  const throttle = { lastTextReportAt: 0 };
  return stdout.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.mapEffect((line) => reportStreamLine(line, report, throttle)),
    Stream.runFold((): ClaudeStreamEvent | undefined => undefined, keepLast)
  );
}

function extractResultEnvelope(
  resultEvent: ClaudeStreamEvent | undefined
): Effect.Effect<ResultEnvelope, ClaudeJsonError> {
  return resultEvent === undefined
    ? new ClaudeJsonError({
        cause: new Error("claude stream-json output ended without a result event"),
      })
    : Effect.succeed(resultEvent);
}

/** Renders a token count compactly, e.g. `14200` -> `"14.2k"`. */
function formatTokenCount(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

/** Renders a USD cost without trailing zeros, e.g. `0.0912297` -> `"$0.0912"`. */
function formatCost(costUsd: number): string {
  return `$${Number(costUsd.toFixed(4))}`;
}

/**
 * Builds the final `usage: <in> in / <out> out tokens ($<cost>)` report line, or `undefined` if the
 * result envelope's token counts are missing (untyped CLI output — degrade gracefully rather than
 * printing `undefined`).
 */
function formatUsageDetail(envelope: ResultEnvelope): string | undefined {
  const inputTokens = envelope.usage?.input_tokens;
  const outputTokens = envelope.usage?.output_tokens;
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const costSuffix =
    envelope.total_cost_usd === undefined ? "" : ` (${formatCost(envelope.total_cost_usd)})`;
  return `usage: ${formatTokenCount(inputTokens)} in / ${formatTokenCount(outputTokens)} out tokens${costSuffix}`;
}

/** Reports the run's final token usage/cost, if `task.report` and the usage fields are both present. */
function reportUsage(
  envelope: ResultEnvelope,
  report: ((detail: string, data?: unknown) => void) | undefined
): void {
  if (report === undefined) return;
  const detail = formatUsageDetail(envelope);
  if (detail !== undefined) report(detail, envelope);
}

/**
 * Runs a Veyor actor through the local Claude Code CLI in headless mode.
 * Based on https://code.claude.com/docs/en/headless
 */
export function claude<A extends Actor.Any>(
  actor: A,
  model: string,
  options: ClaudeOptions = {}
): Actor.ImplementationOf<A> {
  const output = actor.contract.Output;
  const json = getJsonSchema(output);

  return {
    ...actor,
    aggregate: (_state) => Promise.resolve({} as unknown as Actor.AggregateOf<A>),
    run(task) {
      const program = Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        const jsonSchema = json["~standard"].jsonSchema.output({ target: "draft-07" });
        const schema = yield* JsonStringify(jsonSchema);
        const input = yield* JsonStringify(task);
        const prompt = ["Complete the following assignment.", input].join("\n\n");

        const args = buildClaudeArgs(model, options, schema);
        yield* Effect.logDebug(`[claude][${model}] args: ${args.join(" ")}`);
        args.push(prompt);

        const handle = yield* spawner.spawn(
          ChildProcess.make("claude", args, { cwd: options.cwd })
        );

        const [resultEvent, stderr, exitCode] = yield* Effect.all(
          [
            streamResultEvent(handle.stdout, task.report),
            handle.stderr.pipe(Stream.decodeText, Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: "unbounded" }
        );

        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new ClaudeExecutionError({ exitCode, stderr });
        }

        const envelope = yield* extractResultEnvelope(resultEvent);
        reportUsage(envelope, task.report);
        if (envelope.is_error === true) {
          return yield* new ClaudeExecutionError({
            exitCode: null,
            stderr: String(envelope.result),
          });
        }

        const raw =
          envelope.structured_output !== undefined
            ? envelope.structured_output
            : yield* JsonParse(envelope.result);

        const result = yield* Effect.tryPromise({
          try: () => Promise.resolve(output["~standard"].validate(raw)),
          catch: (cause) => new ClaudeJsonError({ cause }),
        });

        if (result.issues === undefined) return result.value;
        return yield* new ClaudeValidationError({ issues: result.issues });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

      // `Effect.timeout*` interrupts the source effect on expiry, which closes the scope above and
      // kills the spawned child process via its `acquireRelease` finalizer — the same mechanism that
      // already kills the process when `task.signal` aborts (handled by `runPromise`'s `signal` option).
      const ceilingMs = options.ceilingMs;
      const bounded =
        ceilingMs === undefined
          ? program
          : program.pipe(
              Effect.timeoutOrElse({
                duration: ceilingMs,
                orElse: () =>
                  new ClaudeCeilingError({
                    actor: actor.name,
                    ceilingMs,
                    message: `${actor.name} worker exceeded ${ceilingMs}ms ceiling`,
                  }),
              })
            );

      return Effect.runPromise(bounded, { signal: task.signal });
    },
  };
}

function buildClaudeArgs(model: string, options: ClaudeOptions, schema: string): string[] {
  const flags: readonly (readonly [flag: string, value: string | undefined])[] = [
    ["--effort", options.effort],
    ["--append-system-prompt", options.instructions],
    ["--permission-mode", options.permissionMode],
    ["--allowed-tools", options.allowedTools?.join(",")],
    ["--disallowed-tools", options.disallowedTools?.join(",")],
    ["--max-budget-usd", options.maxBudgetUsd?.toString()],
  ];

  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    schema,
    "--no-session-persistence",
    "--model",
    model,
    ...flags.flatMap(([flag, value]) => (value === undefined || value === "" ? [] : [flag, value])),
  ];
}
