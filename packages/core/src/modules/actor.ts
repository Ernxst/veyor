import type { StandardSchemaV1 } from "@standard-schema/spec";
import { getJsonSchema, type VeyorSchema } from "../lib/schema/index.ts";
import { Kind, Meta } from "../lib/types.ts";
import type { Task } from "./task.ts";

export interface Actor<
  Name extends string = string,
  Context = unknown,
  Input = unknown,
  Output extends Actor.Result = Actor.Result,
> {
  readonly [Kind]: "Actor";
  readonly [Meta]: { Context: Context; Input: Input; Output: Output };
  readonly name: Name;
  readonly contract: {
    readonly Context: VeyorSchema<unknown, Context> | undefined;
    readonly Input: VeyorSchema<unknown, Input>;
    readonly Output: VeyorSchema<unknown, Output>;
  };
}

export declare namespace Actor {
  // oxlint-disable-next-line typescript/no-explicit-any
  export type Any = Actor<string, any, any, any>;
  export type ContextOf<A extends Any> = A[typeof Meta]["Context"];
  export type InputOf<A extends Any> = A[typeof Meta]["Input"];
  export type OutputOf<A extends Any> = A[typeof Meta]["Output"];
  export type OutcomeOf<A extends Actor.Any> = Actor.OutputOf<A>["outcome"];

  export interface Result<Outcome extends string = string> {
    readonly outcome: Outcome;
  }

  export interface Impl<
    Name extends string = string,
    Context = unknown,
    Input = unknown,
    Output extends Actor.Result = Actor.Result,
  > extends Actor<Name, Context, Input, Output> {
    readonly run: (task: Task.Input<Context, Input>) => Promise<Output>;
  }

  export type ImplementationsOf<Actors extends readonly Any[]> = Actors[number] extends infer A
    ? A extends Any
      ? ImplementationOf<A>
      : never
    : never;

  export type Assemble<Actors extends readonly Any[]> = readonly ImplementationsOf<Actors>[];

  export type ImplementationOf<A extends Any> = Actor.Impl<
    A["name"],
    ContextOf<A>,
    InputOf<A>,
    OutputOf<A>
  >;
}

export function actor<
  const Name extends string,
  Input,
  Output extends Actor.Result,
  Context = unknown,
>(
  name: Name,
  contract: {
    input: StandardSchemaV1<unknown, Input>;
    output: StandardSchemaV1<unknown, Output>;
    context?: StandardSchemaV1<unknown, Context>;
  }
): Actor<Name, Context, Input, Output> {
  return Object.freeze({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    [Meta]: {} as unknown as {
      Context: Context;
      Input: Input;
      Output: Output;
    },
    [Kind]: "Actor" as const,
    name,
    contract: Object.freeze({
      Context: contract.context === undefined ? undefined : getJsonSchema(contract.context),
      Input: getJsonSchema(contract.input),
      Output: getJsonSchema(contract.output),
    }),
  } satisfies Actor<Name, Context, Input, Output>);
}
