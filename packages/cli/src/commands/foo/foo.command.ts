import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { handle } from "./foo.handler.ts";

export const fooCommand = Command.make("foo", { text: Argument.string("text") }, ({ text }) =>
  handle(text).pipe(Effect.flatMap(Console.log))
).pipe(Command.withDescription("Uppercase text"));
