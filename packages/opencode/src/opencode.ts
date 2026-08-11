import { NodeServices } from "@effect/platform-node";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Actor } from "@veyor/core";
import { getJsonSchema } from "@veyor/core/schema";
import { JsonParse, JsonStringify } from "@veyor/core/schema/effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export interface OpencodeOptions {
  readonly instructions?: string;
  readonly cwd?: string;
  /** A named opencode agent configuration to run under. */
  readonly agent?: string;
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
    aggregate: (_state) => Promise.resolve({} as unknown as Actor.AggregateOf<A>),
    run(task) {
      return Effect.runPromise(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

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

          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              handle.stdout.pipe(Stream.decodeText, Stream.mkString),
              handle.stderr.pipe(Stream.decodeText, Stream.mkString),
              handle.exitCode,
            ],
            { concurrency: "unbounded" }
          );

          if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
            return yield* new OpencodeExecutionError({ exitCode, stderr });
          }

          const raw = yield* JsonParse(extractJson(stdout)).pipe(
            Effect.mapError((cause) => new OpencodeJsonError({ cause }))
          );

          const result = yield* Effect.tryPromise({
            try: () => Promise.resolve(output["~standard"].validate(raw)),
            catch: (cause) => new OpencodeJsonError({ cause }),
          });

          if (result.issues === undefined) return result.value;
          return yield* new OpencodeValidationError({ issues: result.issues });
        }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
        { signal: task.signal }
      );
    },
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
    ...flags.flatMap(([flag, value]) => (value === undefined ? [] : [flag, value])),
    prompt,
  ];
}

/** Best-effort extraction of the response's JSON object from free-form output. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate;
}
