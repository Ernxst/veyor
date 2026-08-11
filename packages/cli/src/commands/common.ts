import type { Machine } from "@veyorhq/core";
import { Console, Effect, Option } from "effect";
import * as Schema from "effect/Schema";
import type { Assembly, VeyorConfig } from "../config.ts";
import { contextFrom, describeIssues, UsageError, type BuiltArg } from "../lift.ts";

/** Reports a command-line mistake and marks the process failed — no stack trace. */
export function usageFail(lines: readonly string[]): Effect.Effect<undefined> {
  return Effect.gen(function* () {
    for (const line of lines) yield* Console.error(line);
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
    return undefined;
  });
}

/** The assembly to use: `--assembly`, else the config's default, else the only one. */
export function resolveAssembly(
  config: VeyorConfig,
  flagged: Option.Option<unknown>,
  configured: string | undefined
): { name: string; assembly: Assembly } | UsageError {
  const names = Object.keys(config.assemblies);
  const name = Option.getOrUndefined(flagged) ?? configured ?? soleName(names);

  if (typeof name !== "string") {
    return new UsageError({ message: `Pass --assembly <${names.join(" | ")}>.` });
  }

  const assembly = config.assemblies[name];
  if (assembly === undefined) {
    return new UsageError({
      message: `Unknown assembly "${name}"; declared: ${names.join(", ")}.`,
    });
  }

  return { name, assembly };
}

function soleName(names: readonly string[]): string | undefined {
  return names.length === 1 ? names[0] : undefined;
}

/**
 * Assembles the partial context from arg values and the `--context` base,
 * then decodes it through the machine's context schema. Reports issues
 * against flag names and resolves to undefined when the run must not start.
 */
export function decodeContext(
  machine: Machine.Any,
  built: readonly BuiltArg[],
  values: Readonly<Record<string, Option.Option<unknown>>>,
  base: unknown
): Effect.Effect<unknown> {
  return Effect.gen(function* () {
    const partial = contextFrom(built, values, base);
    if (Schema.is(UsageError)(partial)) return yield* usageFail([partial.message]);

    const contract = machine.contract.Context["~standard"];
    const result = yield* Effect.promise(() => Promise.resolve(contract.validate(partial)));
    if (result.issues !== undefined) {
      return yield* usageFail(describeIssues(result.issues, built));
    }

    return result.value;
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
