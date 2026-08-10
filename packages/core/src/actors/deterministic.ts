import { validate } from "../lib/schema/validate.ts";
import type { Promisable } from "../lib/types.ts";
import type { Actor } from "../modules/actor.ts";
import type { Task } from "../modules/task.ts";

export function deterministic<A extends Actor.Any, const Output extends Actor.OutputOf<A>>(
  actor: A,
  run: (task: Task.Input<Actor.ContextOf<A>, Actor.InputOf<A>>) => Output
): Actor.ImplementationOf<A>;

export function deterministic<A extends Actor.Any, const Output extends Actor.OutputOf<A>>(
  actor: A,
  run: (task: Task.Input<Actor.ContextOf<A>, Actor.InputOf<A>>) => PromiseLike<Output>
): Actor.ImplementationOf<A>;

export function deterministic<A extends Actor.Any>(
  actor: A,
  run: (task: Task.Input<Actor.ContextOf<A>, Actor.InputOf<A>>) => Promisable<Actor.OutputOf<A>>
): Actor.ImplementationOf<A> {
  return {
    ...actor,
    aggregate: () => Promise.resolve(),
    // @effect-diagnostics-next-line asyncFunction:off
    async run(task) {
      const raw = await run(task);
      return await validate(actor.contract.Output, raw, "deterministic output", actor.name);
    },
  };
}
