import { NodeServices } from "@effect/platform-node";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Actor } from "@veyor/core";
import { getJsonSchema } from "@veyor/core/schema";
import { JsonParse, JsonStringify } from "@veyor/core/schema/effect";
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
    aggregate: (_state) => Promise.resolve({} as unknown as Actor.AggregateOf<A>),
    run(task) {
      return Effect.runPromise(
        Effect.gen(function* () {
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

          const handle = yield* spawner.spawn(
            ChildProcess.make("codex", args, { cwd: options.cwd, stdout: "inherit" })
          );

          const [stderr, exitCode] = yield* Effect.all(
            [handle.stderr.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
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
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
        { signal: task.signal }
      );
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
