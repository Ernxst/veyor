import { Effect } from "effect";

export const handle = (text: string) => Effect.succeed(text.split("").reverse().join(""));
