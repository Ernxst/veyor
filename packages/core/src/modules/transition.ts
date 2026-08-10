import type { Task } from "./task.ts";

export interface Transition<
  From extends string = string,
  To extends string = string,
  On extends string = string,
> {
  readonly from: From;
  readonly to: To;
  readonly on: On;
}

export declare namespace Transition {
  export interface Options<On extends string> {
    readonly on: On;
  }

  type FromTask<
    Tasks extends readonly Task.Any[],
    From extends Exclude<Task.NamesOf<Tasks>, Task.SinkNamesOf<Tasks>>,
  > = Transition<
    From,
    Task.NamesOf<Tasks>,
    Task.OutcomesOf<Extract<Tasks[number], { readonly name: From }>>
  >;

  export type From<Tasks extends readonly Task.Any[]> = readonly {
    [From in Exclude<Task.NamesOf<Tasks>, Task.SinkNamesOf<Tasks>>]: FromTask<Tasks, From>;
  }[Exclude<Task.NamesOf<Tasks>, Task.SinkNamesOf<Tasks>>][];
}

export function transition<
  const From extends string,
  const To extends string,
  const On extends string,
>(from: From, to: To, options: Transition.Options<On>): Transition<From, To, On> {
  return Object.freeze({ from, to, on: options.on });
}
