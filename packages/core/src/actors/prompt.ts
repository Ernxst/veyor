import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { validate } from "../lib/schema/validate.ts";
import type { Actor } from "../modules/actor.ts";

export interface PromptOptions<Input, Output> {
  format: PromptFormat<Input, Output>;
}

export interface PromptFormat<Input, Output> {
  render: (q: Input) => string;
  parse: (raw: string, q: Input) => Output; // maps raw input -> one of q.options, or throws
}

export function prompt<A extends Actor.Any>(
  actor: A,
  { format }: PromptOptions<Actor.InputOf<A>, Actor.OutputOf<A>>
): Actor.ImplementationOf<A> {
  return {
    ...actor,
    aggregate: () => Promise.resolve(),
    run(task) {
      const rl = createInterface({ input: stdin, output: stdout });
      return rl
        .question(format.render(task.input), { signal: task.signal })
        .then((raw) => format.parse(raw, task.input))
        .then((output) => validate(actor.contract.Output, output, "prompt output", actor.name))
        .finally(() => rl.close());
    },
  };
}

export function question(): PromptFormat<
  {
    question: string;
    options?: string[] | readonly string[] | undefined;
  },
  { outcome: "answered"; answer: string }
> {
  return {
    render: (q) =>
      q.options !== undefined
        ? `${q.question}\n${q.options.map((o, i) => `  ${i + 1}) ${o}`).join("\n")}\n> `
        : `${q.question}\n> `,
    parse: (raw, q) => ({
      outcome: "answered",
      answer: parseQuestionAnswer(raw, q.options),
    }),
  };
}

function parseQuestionAnswer(
  raw: string,
  options: string[] | readonly string[] | undefined
): string {
  if (options === undefined) return raw.trim();

  const input = raw.trim();
  const numericAnswer = options[Number(input) - 1];
  if (numericAnswer !== undefined) return numericAnswer;

  const textAnswer = options.find((option) => option.toLowerCase() === input.toLowerCase());
  if (textAnswer !== undefined) return textAnswer;

  throw new Error(`Enter a number or option from this list: ${options.join(", ")}.`);
}

export function review(): PromptFormat<
  { summary: string; diff?: string },
  { outcome: "continue" | "abandon"; notes?: string }
> {
  return {
    render: (q) =>
      `${q.summary}${q.diff !== undefined ? `\n\n${q.diff}` : ""}\n\ncontinue or abandon?\n> `,
    parse: (raw) => {
      const [outcomeRaw, ...rest] = raw.trim().split(/\s+/);
      const outcome = outcomeRaw?.toLowerCase();
      if (outcome !== "continue" && outcome !== "abandon") {
        throw new Error('Enter "continue" or "abandon".');
      }

      const notes = rest.join(" ").trim();
      return { outcome, ...(notes.length > 0 ? { notes } : {}) };
    },
  };
}
