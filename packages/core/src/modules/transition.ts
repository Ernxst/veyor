import type { Meta } from "../lib/types.ts";
import type { Task } from "./task.ts";

export interface Transition<
  From extends string = string,
  To extends string = string,
  On extends string = string,
  Context = unknown,
> {
  readonly from: From;
  readonly to: To;
  readonly on: On;
  /**
   * Routes on context in addition to the outcome. Transitions are evaluated
   * in declaration order and the first whose outcome matches and whose guard
   * passes wins; guards see the context after the actor's `update` has been
   * folded in. Guards must be pure and synchronous.
   */
  readonly when?: (context: Context) => boolean;
}

export declare namespace Transition {
  /** Contract-erased view of a transition; what compilers work against. */
  // oxlint-disable-next-line typescript/no-explicit-any
  export type Any = Transition<string, string, string, any>;

  export interface Options<On extends string, Context = unknown> {
    readonly on: On;
    readonly when?: (context: Context) => boolean;
  }

  type FromTask<
    Tasks extends readonly Task.Any[],
    From extends Exclude<Task.NamesOf<Tasks>, Task.SinkNamesOf<Tasks>>,
  > = Transition<
    From,
    Task.NamesOf<Tasks>,
    Task.OutcomesOf<Extract<Tasks[number], { readonly name: From }>>,
    Tasks[number][typeof Meta]["Context"]
  >;

  export type From<Tasks extends readonly Task.Any[]> = readonly {
    [From in Exclude<Task.NamesOf<Tasks>, Task.SinkNamesOf<Tasks>>]: FromTask<Tasks, From>;
  }[Exclude<Task.NamesOf<Tasks>, Task.SinkNamesOf<Tasks>>][];
}

export function transition<
  const From extends string,
  const To extends string,
  const On extends string,
  Context = unknown,
>(from: From, to: To, options: Transition.Options<On, Context>): Transition<From, To, On, Context> {
  return Object.freeze({
    from,
    to,
    on: options.on,
    ...(options.when === undefined ? {} : { when: options.when }),
  });
}
