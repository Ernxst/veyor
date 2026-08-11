#!/usr/bin/env bun

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Stdio } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { makeInspect } from "./commands/inspect.ts";
import { makeRun } from "./commands/run.ts";
import { makeSimulate } from "./commands/simulate.ts";
import type { ForgeConfig } from "./config.ts";
import { loadConfig } from "./load.ts";

function buildCli(config: ForgeConfig | undefined) {
  if (config === undefined) {
    return Command.make("forge").pipe(
      Command.withDescription(
        "Run typed workflow factories. No forge.config.ts found in this directory — " +
          "create one with defineConfig({ assemblies, args }) from @forge/cli."
      )
    );
  }

  return Command.make("forge").pipe(
    Command.withDescription(
      [config.name, config.description].filter((part) => part !== undefined).join(" — ") ||
        "Run typed workflow factories."
    ),
    Command.withSubcommands([makeRun(config), makeSimulate(config), makeInspect(config)])
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
