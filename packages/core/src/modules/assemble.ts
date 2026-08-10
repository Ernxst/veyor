import { createActor, toPromise } from "xstate";
import { validate } from "../lib/schema/validate.ts";
import type { Actor } from "./actor.ts";
import { compile, Failed, type Runtime } from "./compilers/xstate.ts";
import type { Machine } from "./machine.ts";
import type { Task } from "./task.ts";

type MissingActorNames<
  Expected extends readonly Actor.Any[],
  Provided extends readonly Actor.Impl[],
> = Exclude<Expected[number]["name"], Provided[number]["name"]>;

type CompleteActors<Expected extends readonly Actor.Any[], Provided extends readonly Actor.Impl[]> =
  MissingActorNames<Expected, Provided> extends never
    ? unknown
    : {
        readonly __missingActorImplementations: MissingActorNames<Expected, Provided>;
      };

export function assemble<M extends Machine.Any, const Actors extends Actor.Assemble<M["actors"]>>(
  machine: M,
  ...actors: Actors & CompleteActors<M["actors"], Actors>
): Machine.Impl<M> {
  const fsm = compile(machine, actors);
  return {
    def: machine,
    // @effect-diagnostics-next-line asyncFunction:off
    async run(context) {
      const contract = machine.contract.Context;
      const input =
        contract === undefined ? context : await validate(contract, context, "context", machine.id);

      const running = createActor(fsm, { input });
      running.start();
      await toPromise(running);

      const snapshot = running.getSnapshot();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the compiler owns this shape
      const runtime = snapshot.context as Runtime;
      if (snapshot.value === Failed) throw runtime.error;

      return {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a done machine rests at a sink
        task: snapshot.value as Task.SinkNamesOf<M["tasks"]>,
        context: runtime.user as Machine.ContextOf<M>,
      };
    },
  };
}
