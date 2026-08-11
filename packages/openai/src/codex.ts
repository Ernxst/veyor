import { NodeServices } from "@effect/platform-node";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Actor } from "@veyorhq/core";
import { getJsonSchema } from "@veyorhq/core/schema";
import { JsonParse, JsonStringify } from "@veyorhq/core/schema/effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export interface CodexOptions {
  readonly effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  readonly verbosity?: "low" | "medium" | "high";
  readonly instructions?: string;
  readonly cwd?: string;
  readonly sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  /**
   * Absolute wall-clock bound on the whole invocation. When it elapses the
   * child process is killed and the run rejects with {@link CodexTimeoutError}.
   */
  readonly ceilingMs?: number;
}

export class CodexExecutionError extends Data.TaggedError("CodexExecutionError")<{
  readonly exitCode: number | null;
  readonly stderr: string;
}> {}

export class CodexJsonError extends Data.TaggedError("CodexJsonError")<{
  readonly cause: unknown;
}> {}

export class CodexValidationError extends Data.TaggedError("CodexValidationError")<{
  readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
}> {}

export class CodexTimeoutError extends Data.TaggedError("CodexTimeoutError")<{
  readonly ceilingMs: number;
}> {
  override get message(): string {
    return `codex exec exceeded its ${this.ceilingMs}ms ceiling and was killed`;
  }
}

/** A single change reported inside a `file_change` item. */
interface CodexFileChange {
  readonly path: string;
  readonly kind: string;
}

/** The slice of a `codex exec --json` item this adapter reads to narrate progress. */
interface CodexItem {
  readonly type: string;
  readonly command?: string;
  readonly exit_code?: number | null;
  readonly changes?: readonly CodexFileChange[];
  readonly message?: string;
  readonly text?: string;
}

/** Token counts carried on a `turn.completed` event. */
interface CodexUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
}

/** The slice of a `codex exec --json` JSONL event this adapter reads. */
interface CodexStreamEvent {
  readonly type: string;
  readonly item?: CodexItem;
  readonly usage?: CodexUsage;
}

type ReportFn = (detail: string, data?: unknown) => void;

const TEXT_REPORT_THROTTLE_MS = 1000;

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

/** Compact token-count formatting, e.g. `14200` -> `14.2k`. */
function formatTokenCount(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}k`;
}

/**
 * Strips the `<shell> -lc`/`-c` wrapper Codex runs commands through, e.g.
 * `/bin/zsh -lc "bun test"` -> `bun test`.
 */
function formatCommand(raw: string): string {
  const match = /^\S*\/(?:bash|zsh|sh)\s+-\S*c\s+(.*)$/.exec(raw);
  const body = match?.[1] !== undefined ? stripQuotes(match[1]) : raw;
  return truncate(body, 120);
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  const wrapped = (first === '"' && last === '"') || (first === "'" && last === "'");
  return wrapped ? value.slice(1, -1) : value;
}

type Throttle = { lastTextReportAt: number };

/** Bundles the sink and throttle state threaded through every item handler. */
interface CodexReportContext {
  readonly report: ReportFn;
  readonly throttle: Throttle;
}

function reportCommandExecution(eventType: string, item: CodexItem, ctx: CodexReportContext): void {
  const detail = `tool: bash (${formatCommand(item.command ?? "?")})`;
  if (eventType !== "item.completed") {
    ctx.report(detail, item);
    return;
  }
  ctx.report(`${detail} -> exit ${String(item.exit_code ?? null)}`, item);
}

function reportFileChange(item: CodexItem, ctx: CodexReportContext): void {
  for (const change of item.changes ?? []) {
    ctx.report(`edit: ${change.path} (${change.kind})`, change);
  }
}

function reportTextItem(label: string, text: string, ctx: CodexReportContext): void {
  const now = performance.now();
  if (now - ctx.throttle.lastTextReportAt < TEXT_REPORT_THROTTLE_MS) return;
  ctx.throttle.lastTextReportAt = now;
  ctx.report(`${label}: ${truncate(text, 200)}`, text);
}

function reportTextIfComplete(
  label: string,
  eventType: string,
  item: CodexItem,
  ctx: CodexReportContext
): void {
  if (eventType !== "item.completed" || item.text === undefined) return;
  reportTextItem(label, item.text, ctx);
}

/** Reports token usage from a `turn.completed` event; degrades to no report if fields are absent. */
function reportUsage(usage: CodexUsage, report: ReportFn): void {
  const { input_tokens: inputTokens, output_tokens: outputTokens } = usage;
  if (inputTokens === undefined || outputTokens === undefined) return;
  report(
    `usage: ${formatTokenCount(inputTokens)} in / ${formatTokenCount(outputTokens)} out tokens`,
    usage
  );
}

type ItemHandler = (eventType: string, item: CodexItem, ctx: CodexReportContext) => void;

/** One handler per `item.type` Codex emits; unrecognized types are silently dropped. */
const CODEX_ITEM_HANDLERS: Record<string, ItemHandler> = {
  command_execution: reportCommandExecution,
  file_change: (eventType, item, ctx) => {
    if (eventType === "item.completed") reportFileChange(item, ctx);
  },
  error: (_eventType, item, ctx) =>
    ctx.report(`error: ${truncate(item.message ?? "unknown error", 120)}`, item),
  agent_message: (eventType, item, ctx) => reportTextIfComplete("text", eventType, item, ctx),
  reasoning: (eventType, item, ctx) => reportTextIfComplete("reasoning", eventType, item, ctx),
};

function parseCodexEvent(line: string): CodexStreamEvent | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- event shapes are read defensively below
    return JSON.parse(trimmed) as CodexStreamEvent;
  } catch {
    return undefined;
  }
}

function isCodexTurnItemEvent(type: string): type is "item.started" | "item.completed" {
  return type === "item.started" || type === "item.completed";
}

/**
 * Parses one JSONL line from `codex exec --json`, narrating tool/edit/error
 * events (always) and agent text (throttled to ~1 report/second) via
 * `task.report`.
 */
function dispatchCodexEvent(event: CodexStreamEvent, report: ReportFn, throttle: Throttle): void {
  if (event.type === "turn.completed") {
    if (event.usage !== undefined) reportUsage(event.usage, report);
    return;
  }

  if (!isCodexTurnItemEvent(event.type) || event.item === undefined) return;

  const handler = CODEX_ITEM_HANDLERS[event.item.type];
  handler?.(event.type, event.item, { report, throttle });
}

function processCodexLine(line: string, report: ReportFn | undefined, throttle: Throttle): void {
  if (report === undefined) return;

  const event = parseCodexEvent(line);
  if (event === undefined) return;

  dispatchCodexEvent(event, report, throttle);
}

/**
 * Based on https://mintlify.wiki/openai/codex/cli/exec
 */
export function codex<A extends Actor.Any>(
  actor: A,
  model: string,
  options: CodexOptions = {}
): Actor.ImplementationOf<A> {
  const output = actor.contract.Output;
  const json = getJsonSchema(output);

  return {
    ...actor,
    run(task) {
      const program = Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        yield* Effect.logDebug(`[codex][${model}] Creating temporary directory`);
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "veyor-codex-" });
        yield* Effect.logDebug(`[codex][${model}] Created temporary directory`);

        const schemaFile = `${directory}/${actor.name}.output.schema.json`;
        const outputFile = `${directory}/${actor.name}.output.json`;

        yield* Effect.logDebug(`[codex][${model}] Writing output JSON schema to ${schemaFile}`);
        const jsonSchema = json["~standard"].jsonSchema.output({ target: "draft-07" });
        const schemaStr = yield* JsonStringify(jsonSchema);
        yield* fs.writeFileString(schemaFile, schemaStr);

        const input = yield* JsonStringify(task);
        const prompt = [options.instructions, "Complete the following assignment.", input]
          .filter(Boolean)
          .join("\n\n");

        const args = buildCodexArgs(model, options, schemaFile, outputFile);

        yield* Effect.logDebug(`[codex][${model}] args: ${args.join(" ")}`);
        args.push(prompt);

        const handle = yield* spawner.spawn(ChildProcess.make("codex", args, { cwd: options.cwd }));

        // Mutated by the stdout fiber below as `codex exec --json` events arrive; read only after
        // the `Effect.all` join, so there is no concurrent access.
        const throttle = { lastTextReportAt: 0 };

        const [, stderr, exitCode] = yield* Effect.all(
          [
            handle.stdout.pipe(
              Stream.decodeText,
              Stream.splitLines,
              Stream.runForEach((line) =>
                Effect.sync(() => processCodexLine(line, task.report, throttle))
              )
            ),
            handle.stderr.pipe(Stream.decodeText, Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: "unbounded" }
        );

        if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
          return yield* new CodexExecutionError({ exitCode, stderr });
        }

        const result = yield* fs.readFileString(outputFile).pipe(
          Effect.flatMap((json) => JsonParse(json)),
          Effect.flatMap((raw) =>
            Effect.tryPromise({
              try: () => Promise.resolve(output["~standard"].validate(raw)),
              catch: (cause) => new CodexJsonError({ cause }),
            })
          )
        );

        if (result.issues === undefined) return result.value;
        return yield* new CodexValidationError({ issues: result.issues });
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
                orElse: () => new CodexTimeoutError({ ceilingMs }),
              })
            );

      return Effect.runPromise(bounded, { signal: task.signal });
    },
  };
}

function buildCodexArgs(
  model: string,
  options: CodexOptions,
  schemaFile: string,
  outputFile: string
): string[] {
  const args = [
    "exec",
    "--full-auto",
    "--json",
    "--color",
    "never",
    "--output-schema",
    schemaFile,
    "--output-last-message",
    outputFile,
    "--sandbox",
    options.sandbox ?? "workspace-write",
    "--model",
    model,
  ];

  if (options.effort !== undefined) {
    args.push("-c", `model_reasoning_effort="${options.effort}"`);
  }

  if (options.verbosity !== undefined) {
    args.push("-c", `model_verbosity="${options.verbosity}"`);
  }

  return args;
}
