import { Kind, Meta } from "../lib/types.ts";
import type { Actor } from "./actor.ts";
import type { Task } from "./task.ts";

export interface Assignment<A extends Actor.Any = Actor.Any, Context = unknown> {
  readonly [Kind]: "Assignment";
  readonly [Meta]: { Context: Context };
  readonly actor: A;
  readonly enabled: (task: Task.Input<Context, Actor.InputOf<A>>) => boolean;
  readonly input: (context: Context) => Actor.InputOf<A>;
  readonly update: (step: Assignment.Step<Context, Actor.InputOf<A>, Actor.OutputOf<A>>) => Context;
}

export declare namespace Assignment {
  /** Contract-erased view of an assignment; what compilers work against. */
  export interface Any {
    readonly [Kind]: "Assignment";
    // oxlint-disable-next-line typescript/no-explicit-any
    readonly [Meta]: { Context: any };
    readonly actor: Actor.Any;
    // oxlint-disable-next-line typescript/no-explicit-any
    readonly enabled: (task: Task.Input<any, any>) => boolean;
    // oxlint-disable-next-line typescript/no-explicit-any
    readonly input: (context: any) => unknown;
    // oxlint-disable-next-line typescript/no-explicit-any
    readonly update: (step: Step<any, any, any>) => unknown;
  }

  export type ContextOf<A extends Assignment> = Actor.ContextOf<A["actor"]>;
  export type ActorsOf<A extends readonly Any[]> = readonly A[number]["actor"][];

  export interface Step<Context, Input, Output> {
    readonly context: Context;
    readonly input: Input;
    readonly output: Output;
  }

  export interface Options<A extends Actor.Any> {
    readonly when?: (task: Task.Input<Actor.ContextOf<A>, Actor.InputOf<A>>) => boolean;
    readonly input?: (context: Actor.ContextOf<A>) => Actor.InputOf<A>;
    readonly update?: (
      step: Step<Actor.ContextOf<A>, Actor.InputOf<A>, Actor.OutputOf<A>>
    ) => Actor.ContextOf<A>;
  }
}

const alwaysEnabled = () => true;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- actors without input receive undefined
const noInput = () => undefined as never;
const keepContext = <Context>({ context }: { context: Context }): Context => context;

export function assign<const A extends Actor.Any>(
  actor: A,
  options: Assignment.Options<A> | NonNullable<Assignment.Options<A>["when"]> = {}
): Assignment<A, Actor.ContextOf<A>> {
  const { when, input, update } = typeof options === "function" ? { when: options } : options;
  return Object.freeze({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    [Meta]: {} as unknown as { Context: Actor.ContextOf<A> },
    [Kind]: "Assignment" as const,
    actor,
    enabled: when ?? alwaysEnabled,
    input: input ?? noInput,
    update: update ?? keepContext,
  } satisfies Assignment<A, Actor.ContextOf<A>>);
}
