import { Console, Effect, FileSystem, Path } from "effect";
import { Command } from "effect/unstable/cli";

export function makeInit() {
  return Command.make("init", {}, handler).pipe(
    Command.withDescription("Scaffold a starter Veyor factory in the working directory")
  );
}

function handler(): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const conflicts = yield* conflictingFiles(fs);
    if (conflicts.length > 0) return yield* reportConflicts(conflicts);

    yield* Effect.forEach(FILES, (file) => write(fs, path, file.path, file.content), {
      discard: true,
    });

    yield* Console.log(nextSteps());
  });
}

function conflictingFiles(fs: FileSystem.FileSystem): Effect.Effect<readonly string[]> {
  return Effect.gen(function* () {
    const existing = yield* Effect.forEach(FILES, (file) =>
      fs.exists(file.path).pipe(Effect.orElseSucceed(() => false))
    );
    return FILES.filter((_, index) => existing[index]).map((file) => file.path);
  });
}

function reportConflicts(conflicts: readonly string[]): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Console.error("veyor init: refusing to overwrite existing file(s):");
    yield* Effect.forEach(conflicts, (conflict) => Console.error(`  ${conflict}`), {
      discard: true,
    });
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  });
}

function write(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  target: string,
  content: string
): Effect.Effect<void, never, never> {
  return Effect.gen(function* () {
    const dir = path.dirname(target);
    if (dir !== ".") yield* fs.makeDirectory(dir, { recursive: true });
    yield* fs.writeFileString(target, content);
  }).pipe(Effect.orDie);
}

function nextSteps(): string {
  return [
    "Scaffolded a starter Veyor factory:",
    ...FILES.map((file) => `  ${file.path}`),
    "",
    "Next steps:",
    "  1. Add the runtime packages if this project doesn't have them yet:",
    "       bun add @veyorhq/core @veyorhq/cli",
    "  2. Run it:",
    '       veyor run "hello"',
  ].join("\n");
}

// --- Templates ---------------------------------------------------------------
//
// The prescribed factory spine (see the "Project structure" section of the
// CLI README): `veyor.config.ts` at the root, then `src/schema.ts`
// (contracts), `src/actors.ts` (roles), `src/blueprint.ts` (the machine), and
// `src/assemblies/starter.ts` (one worker bound to the blueprint). Each file
// imports only from the files above it. Declared below the templates they
// reference so the templates need no forward declarations.

const CONFIG_TEMPLATE = `import { defineConfig } from "@veyorhq/cli";
import starter from "./src/assemblies/starter.ts";

export default defineConfig({
  name: "starter-factory",
  description: "A minimal Veyor factory: one task, one worker, one sink",
  assemblies: { starter },
  args: [{ key: "input.task", position: 0, description: "What to deliver" }],
  run: { assembly: "starter", success: "done" },
  examples: [{ command: 'veyor run "hello"' }],
});
`;

const SCHEMA_TEMPLATE = `import { schema } from "@veyorhq/core/schema/effect";
import { Effect } from "effect";
import * as Schema from "effect/Schema";

// --- Machine context ---------------------------------------------------------

const ContextStruct = Schema.Struct({
  input: Schema.Struct({
    task: Schema.String,
  }),
  /** How many times the worker has run. */
  attempts: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
});

export type Context = Schema.Schema.Type<typeof ContextStruct>;
export const Context = schema(ContextStruct);

// --- Task contracts ----------------------------------------------------------

export const WorkRequest = Schema.Struct({
  task: Schema.String,
});

export const WorkOutput = Schema.Struct({
  outcome: Schema.Literal("done"),
  summary: Schema.String,
});

export type WorkOutput = Schema.Schema.Type<typeof WorkOutput>;
`;

const ACTORS_TEMPLATE = `import { actor } from "@veyorhq/core";
import { schema } from "@veyorhq/core/schema/effect";
import * as Schema from "./schema.ts";

export const Worker = actor("worker", {
  input: schema(Schema.WorkRequest),
  output: schema(Schema.WorkOutput),
  context: Schema.Context,
});
`;

const BLUEPRINT_TEMPLATE = `import { assign, machine, sink, task, transition } from "@veyorhq/core";
import * as actors from "./actors.ts";
import * as Schema from "./schema.ts";

export const StarterBlueprint = machine({
  id: "starter-factory",
  initial: "work",
  context: Schema.Context,
  retries: 3,
  tasks: [
    task(
      "work",
      assign(actors.Worker, {
        input: (context) => ({ task: context.input.task }),
        update: ({ context }) => ({ ...context, attempts: context.attempts + 1 }),
      })
    ),
    sink("done"),
  ],
  transitions: [transition("work", "done", { on: "done" })],
});
`;

const ASSEMBLY_TEMPLATE = `import { assemble } from "@veyorhq/core";
import { deterministic } from "@veyorhq/core/actors";
import * as actors from "../actors.ts";
import { StarterBlueprint } from "../blueprint.ts";

/**
 * A deterministic starter worker — no adapter dependency. Replace with a
 * model-backed implementation (from @veyorhq/anthropic, @veyorhq/openai, or
 * @veyorhq/opencode) once there is judgment this task should exercise.
 */
export default assemble(
  StarterBlueprint,
  deterministic(actors.Worker, ({ input, report }) => {
    report?.(\`working on: \${input.task}\`);
    return { outcome: "done" as const, summary: \`Completed: \${input.task}\` };
  })
);
`;

const FILES: ReadonlyArray<{ readonly path: string; readonly content: string }> = [
  { path: "veyor.config.ts", content: CONFIG_TEMPLATE },
  { path: "src/schema.ts", content: SCHEMA_TEMPLATE },
  { path: "src/actors.ts", content: ACTORS_TEMPLATE },
  { path: "src/blueprint.ts", content: BLUEPRINT_TEMPLATE },
  { path: "src/assemblies/starter.ts", content: ASSEMBLY_TEMPLATE },
];
