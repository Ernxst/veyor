#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Stdio } from "effect";
import { Command } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { barCommand } from "./commands/bar/bar.command.ts";
import { fooCommand } from "./commands/foo/foo.command.ts";

const cli = Command.make("forge").pipe(
  Command.withDescription("Explore and improve codebase architecture."),
  Command.withShortDescription("Codebase architecture explorer"),
  Command.withSubcommands([fooCommand, barCommand])
);

const program = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  yield* Command.runWith(cli, { version: packageJson.version })(yield* stdio.args);
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
