#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Stdio } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { makeInit } from "./commands/init.ts";
import { makeInspect } from "./commands/inspect.ts";
import { makeRun } from "./commands/run.ts";
import { makeSimulate } from "./commands/simulate.ts";
import type { VeyorConfig } from "./config.ts";
import { loadConfig } from "./load.ts";

function buildCli(config: VeyorConfig | undefined) {
  if (config === undefined) {
    return Command.make("veyor").pipe(
      Command.withDescription(
        "Run typed workflow factories. No veyor.config.ts found in this directory — " +
          "run `veyor init` to scaffold one, or create one yourself with " +
          "defineConfig({ assemblies, args }) from @veyorhq/cli."
      ),
      Command.withSubcommands([makeInit()])
    );
  }

  return Command.make("veyor").pipe(
    Command.withDescription(
      [config.name, config.description].filter((part) => part !== undefined).join(" — ") ||
        "Run typed workflow factories."
    ),
    Command.withSubcommands([
      makeRun(config),
      makeSimulate(config),
      makeInspect(config),
      makeInit(),
    ])
  );
}

const program = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const config = yield* loadConfig;
  const cli = buildCli(config);
  yield* Command.runWith(cli, { version: config?.version ?? packageJson.version })(
    yield* stdio.args
  );
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
