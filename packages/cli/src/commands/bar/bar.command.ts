import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { handle } from "./bar.handler.ts";

export const barCommand = Command.make("bar", { text: Argument.string("text") }, ({ text }) =>
  handle(text).pipe(Effect.flatMap(Console.log))
).pipe(Command.withDescription("Reverse text"));
