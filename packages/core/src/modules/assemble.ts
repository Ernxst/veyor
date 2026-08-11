import { createActor, toPromise } from "xstate";
import { validate } from "../lib/schema/validate.ts";
import type { Actor } from "./actor.ts";
import { compile, Failed, type Runtime } from "./compilers/xstate.ts";

/** The task a (possibly compound) state value denotes. */
function stateName(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const key = Object.keys(value).at(0);
    if (key !== undefined) return key;
  }

  return String(value);
}
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
  return {
    def: machine,
    // @effect-diagnostics-next-line asyncFunction:off
    async run(context, options) {
      const fsm = compile(machine, actors, options?.observer);
      const input = await validate(machine.contract.Context, context, "context", machine.id);

      const running = createActor(fsm, { input });

      // Transitions are observed from the snapshot stream — XState evaluates
      // function-form transitions speculatively, so they must stay pure.
      let previous: string | undefined;
      const subscription = running.subscribe({
        next: (snapshot) => {
          const value = stateName(snapshot.value);
          if (previous !== undefined && value !== previous && options?.observer !== undefined) {
            options.observer({ type: "transition", from: previous, to: value });
          }
          previous = value;
        },
        // Failures surface through toPromise below; an errorless subscriber
        // would re-report them as unhandled.
        error: () => undefined,
      });

      running.start();
      previous = stateName(running.getSnapshot().value);
      await toPromise(running).finally(() => subscription.unsubscribe());

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
