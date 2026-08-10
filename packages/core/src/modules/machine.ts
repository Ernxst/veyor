import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Kind, Meta } from "../lib/types.ts";
import type { Actor } from "./actor.ts";
import type { Task } from "./task.ts";
import type { Transition } from "./transition.ts";

// TODO: prevent duplicate tasks and transitions at the type level
export interface Machine<
  Context,
  Tasks extends readonly Task<string, Context>[],
  Initial extends Task.NamesOf<Tasks>,
  Transitions extends Transition.From<Tasks>,
> {
  readonly [Kind]: "Machine";
  readonly [Meta]: { Context: Context };
  readonly id: string;
  readonly initial: Initial;
  readonly tasks: Tasks;
  readonly transitions: Transitions;
  readonly retries: number;
  readonly actors: Task.ActorsOf<Tasks>;
  readonly contract: {
    readonly Context: StandardSchemaV1<unknown, Context> | undefined;
  };
}

export declare namespace Machine {
  /** Contract-erased view of a machine; what compilers work against. */
  export interface Any {
    readonly [Kind]: "Machine";
    // oxlint-disable-next-line typescript/no-explicit-any
    readonly [Meta]: { Context: any };
    readonly id: string;
    readonly initial: string;
    readonly tasks: readonly Task.Any[];
    readonly transitions: readonly Transition.Any[];
    readonly retries: number;
    readonly actors: readonly Actor.Any[];
    readonly contract: {
      readonly Context: StandardSchemaV1 | undefined;
    };
  }

  export type ContextOf<M extends Any> = M[typeof Meta]["Context"];

  export interface Definition<
    Context,
    Tasks extends readonly Task<string, Context>[],
    Initial extends Task.NamesOf<Tasks>,
    Transitions extends Transition.From<Tasks>,
  > {
    readonly id: string;
    readonly initial: Initial;
    readonly tasks: Tasks;
    readonly transitions: Transitions;
    readonly context?: StandardSchemaV1<unknown, Context>;
    /** How many times a failed task invocation is retried before the run fails. */
    readonly retries?: number;
  }

  export interface Impl<M extends Any> {
    readonly def: M;
    run(
      context: ContextOf<M>,
      options?: RunOptions
    ): Promise<Result<ContextOf<M>, Task.SinkNamesOf<M["tasks"]>>>;
  }

  export interface RunOptions {
    /** Receives progress events as the machine runs; the first slice of run history. */
    readonly observer?: (event: RunEvent) => void;
  }

  export type RunEvent =
    | { readonly type: "invoke"; readonly task: string; readonly actor: string }
    | {
        readonly type: "complete";
        readonly task: string;
        readonly actor: string;
        readonly outcome: string;
        readonly durationMs: number;
      }
    | {
        readonly type: "error";
        readonly task: string;
        readonly actor: string;
        readonly error: unknown;
        readonly durationMs: number;
      }
    | { readonly type: "retry"; readonly task: string; readonly attempt: number }
    | { readonly type: "transition"; readonly from: string; readonly to: string };

  export interface Result<Context, Sink extends string = string> {
    readonly task: Sink;
    readonly context: Context;
  }

  export interface History {
    readonly task: Task.Any;
    readonly actor: Actor;
    readonly input: unknown;
    readonly output?: unknown;
    readonly outcome: Task.Status;
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly attempt: number;
  }

  export interface State {
    readonly id: string;
    readonly status: Task.Status;
    readonly currentTask: string;
    readonly context: unknown;
    readonly history: readonly History[];
  }
}

export function machine<
  Context,
  const Tasks extends readonly Task<string, Context>[],
  const Initial extends Task.NamesOf<Tasks>,
  const Transitions extends Transition.From<Tasks>,
>(
  definition: Machine.Definition<Context, Tasks, Initial, Transitions>
): Machine<Context, Tasks, Initial, Transitions> {
  return Object.freeze({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    [Meta]: {} as unknown as { Context: Context },
    [Kind]: "Machine" as const,
    id: definition.id,
    initial: definition.initial,
    tasks: definition.tasks,
    transitions: definition.transitions,
    retries: definition.retries ?? 2,
    actors: definition.tasks.flatMap((t) => t.assignments.map((a) => a.actor)),
    contract: Object.freeze({ Context: definition.context }),
  } satisfies Machine<Context, Tasks, Initial, Transitions>);
}
