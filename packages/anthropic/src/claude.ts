import { NodeServices } from "@effect/platform-node";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Actor } from "@veyorhq/core";
import { getJsonSchema } from "@veyorhq/core/schema";
import { JsonParse, JsonStringify } from "@veyorhq/core/schema/effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
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

/** The slice of Claude Code's `--output-format json` envelope this adapter reads. */
interface ResultEnvelope {
  readonly is_error?: boolean;
  readonly result?: unknown;
  readonly structured_output?: unknown;
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
      return Effect.runPromise(
        Effect.gen(function* () {
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

          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              handle.stdout.pipe(Stream.decodeText, Stream.mkString),
              handle.stderr.pipe(Stream.decodeText, Stream.mkString),
              handle.exitCode,
            ],
            { concurrency: "unbounded" }
          );

          if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
            return yield* new ClaudeExecutionError({ exitCode, stderr });
          }

          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- envelope fields are re-validated below
          const envelope = (yield* JsonParse(stdout)) as ResultEnvelope;
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
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
        { signal: task.signal }
      );
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
    "json",
    "--json-schema",
    schema,
    "--no-session-persistence",
    "--model",
    model,
    ...flags.flatMap(([flag, value]) => (value === undefined || value === "" ? [] : [flag, value])),
  ];
}
