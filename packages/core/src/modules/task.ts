import { Kind, Meta } from "../lib/types.ts";
import type { Actor } from "./actor.ts";
import type { Assignment } from "./assignment.ts";

const Sink: unique symbol = Symbol.for("Forge.Sink");

// TODO: support a machine calling itself to build a real factory
export interface Task<
  Name extends string = string,
  Context = unknown,
  Assignments extends readonly Assignment.Any[] = readonly Assignment.Any[],
> {
  readonly [Kind]: "Task";
  readonly [Meta]: { Context: Context };
  readonly name: Name;
  readonly assignments: Assignments;
}

// oxlint-disable-next-line typescript/no-explicit-any -- ctx doesn't need to match against machine as it has no actor
export interface Sink<Name extends string = string, Context = any> extends Task<
  Name,
  Context,
  readonly []
> {
  readonly [Sink]: true;
}

export declare namespace Task {
  // oxlint-disable-next-line typescript/no-explicit-any
  export type Any = Task<string, any, readonly Assignment.Any[]>;
  export type Status = "completed" | "failed" | "cancelled";

  export type NamesOf<Tasks extends readonly Any[]> = Tasks[number]["name"];

  export type SinkNamesOf<Tasks extends readonly Any[]> = Extract<
    Tasks[number],
    { readonly [Sink]: true }
  >["name"];

  export type ActorsOf<Tasks extends readonly Any[]> = Assignment.ActorsOf<
    Tasks[number]["assignments"]
  >;
  export type OutcomesOf<T extends Any> = Actor.OutcomeOf<T["assignments"][number]["actor"]>;

  export interface ExecutionMeta {
    readonly retryCount: number;
  }

  export interface Input<Context, Input> {
    readonly meta: ExecutionMeta;
    readonly context: Context;
    readonly input: Input;
    readonly signal: AbortSignal;
  }
}

export function task<
  const Name extends string,
  const Assignments extends readonly Assignment.Any[],
>(
  name: Name,
  ...actors: Assignments
): Task<Name, Assignment.ContextOf<Assignments[number]>, Assignments> {
  return Object.freeze({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    [Meta]: {} as unknown as { Context: Assignment.ContextOf<Assignments[number]> },
    [Kind]: "Task" as const,
    name,
    assignments: actors,
  } satisfies Task<Name, Assignment.ContextOf<Assignments[number]>, Assignments>);
}

export function sink<const Name extends string>(name: Name): Sink<Name> {
  return Object.freeze({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    [Meta]: {} as unknown as { Context: never },
    [Kind]: "Task" as const,
    [Sink]: true,
    name,
    assignments: [],
  } satisfies Sink<Name>);
}

export function isSink(task: Task.Any): task is Sink {
  return Sink in task;
}
