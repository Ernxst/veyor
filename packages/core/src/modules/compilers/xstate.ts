import { setup, type DoneActorEvent, type ErrorActorEvent } from "xstate";
import { createAsyncLogic } from "xstate/actors";
import type { Actor } from "../actor.ts";
import type { Assignment } from "../assignment.ts";
import type { Machine } from "../machine.ts";
import { isSink, type Task } from "../task.ts";

/** Internal final state a run enters when a task exhausts its retries. */
export const Failed = "veyor:failed";

/**
 * The compiled machine wraps the blueprint's context so retry state and the
 * terminal error can travel with it without leaking into actor contracts.
 */
export interface Runtime {
  readonly user: unknown;
  readonly retryCount: number;
  readonly error?: unknown;
}

type InvocationInput = Omit<Task.Input<unknown, unknown>, "signal">;

const selectionSignal = new AbortController().signal;

export function compile<M extends Machine.Any>(
  machine: M,
  actors: readonly Actor.ImplementationOf<Actor.Any>[],
  options?: Machine.RunOptions
) {
  return setup({ actors: compileActors(machine, actors, options) }).createMachine({
    id: machine.id,
    initial: machine.initial,
    context: ({ input }): Runtime => ({ user: input, retryCount: 0 }),
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- state shapes are compiled dynamically
    states: {
      ...compileTasks(machine),
      [Failed]: { id: Failed, type: "final" },
    },
  });
}

interface RecordedOutput {
  readonly outcome: string;
  readonly output: Actor.Result;
}

/**
 * Walks a recorded run's completions in order: each invocation the record
 * covers returns its recorded output; past the record, invocations run live.
 * A mismatch between what the machine selects and what the record holds is
 * divergence — replaying wrong outputs would corrupt the fold, so it throws.
 */
function replayCursor(events: readonly Machine.RunEvent[] | undefined) {
  const completions = (events ?? []).filter(
    (event): event is Extract<Machine.RunEvent, { type: "complete" }> => event.type === "complete"
  );
  let cursor = 0;

  return {
    next(task: string, actor: string): RecordedOutput | undefined {
      const entry = completions[cursor];
      if (entry === undefined) return undefined;
      if (entry.task !== task || entry.actor !== actor) {
        throw new Error(
          `Replay diverged at "${task} · ${actor}": the record holds "${entry.task} · ${entry.actor}". ` +
            "The blueprint changed, or the original run escalated across assignments — run without the record."
        );
      }

      cursor += 1;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the record holds validated outputs
      return { outcome: entry.outcome, output: entry.output as Actor.Result };
    },
  };
}

function compileActors(
  machine: Machine.Any,
  actors: readonly Actor.ImplementationOf<Actor.Any>[],
  options?: Machine.RunOptions
) {
  const observer = options?.observer;
  const replay = replayCursor(options?.replay);
  const byName = Object.fromEntries(actors.map((actor) => [actor.name, actor]));
  return Object.fromEntries(
    machine.tasks.flatMap((task: Task.Any) =>
      task.assignments.map((assignment: Assignment.Any) => [
        assignment.actor.name,
        createAsyncLogic<Actor.Result, InvocationInput>({
          id: assignment.actor.name,
          run: ({ input, signal }) => {
            const actor = assignment.actor.name;
            const concrete = byName[actor];
            if (concrete === undefined) {
              throw new Error(
                `Actor "${actor}" has no implementation. Add one before running the machine.`
              );
            }

            if (input.meta.retryCount > 0) {
              observer?.({ type: "retry", task: task.name, attempt: input.meta.retryCount });
            }

            const recorded = replay.next(task.name, actor);
            if (recorded !== undefined) {
              observer?.({
                type: "invoke",
                task: task.name,
                actor,
                input: input.input,
                replayed: true,
              });
              observer?.({
                type: "complete",
                task: task.name,
                actor,
                outcome: recorded.outcome,
                output: recorded.output,
                durationMs: 0,
                replayed: true,
              });
              return Promise.resolve(recorded.output);
            }

            observer?.({ type: "invoke", task: task.name, actor, input: input.input });
            const report = (detail: string, data?: unknown): void => {
              observer?.(
                data === undefined
                  ? { type: "activity", task: task.name, actor, detail }
                  : { type: "activity", task: task.name, actor, detail, data }
              );
            };
            const started = performance.now();
            return concrete.run({ ...input, signal, report }).then(
              (output: Actor.Result) => {
                observer?.({
                  type: "complete",
                  task: task.name,
                  actor,
                  outcome: output.outcome,
                  output,
                  durationMs: performance.now() - started,
                });
                return output;
              },
              (error: unknown) => {
                observer?.({
                  type: "error",
                  task: task.name,
                  actor,
                  error,
                  durationMs: performance.now() - started,
                });
                throw error;
              }
            );
          },
        }),
      ])
    )
  );
}

function invocationInput(assignment: Assignment.Any, runtime: Runtime): InvocationInput {
  return {
    context: runtime.user,
    input: assignment.input(runtime.user),
    meta: { retryCount: runtime.retryCount },
  };
}

/**
 * Folds the actor's output into context, then routes by outcome and guard.
 * Transitions are tried in declaration order against the updated context;
 * the first whose guard passes (or that has none) wins.
 */
function completion(machine: Machine.Any, task: Task.Any, assignment: Assignment.Any) {
  const outgoing = machine.transitions.filter((t) => t.from === task.name);

  return ({ context, event }: { context: Runtime; event: DoneActorEvent<Actor.Result> }) => {
    const outcome = event.output.outcome;
    const candidates = outgoing.filter((t) => t.on === outcome);
    if (candidates.length === 0) {
      throw new Error(`Task "${task.name}" has no transition for outcome "${outcome}".`);
    }

    const user = assignment.update({
      context: context.user,
      input: assignment.input(context.user),
      output: event.output,
    });

    const next = candidates.find((t) => t.when === undefined || t.when(user));
    if (next === undefined) {
      throw new Error(
        `Task "${task.name}" matched ${candidates.length} transition(s) for outcome "${outcome}", but every guard refused.`
      );
    }

    return {
      target: `#${machine.id}.${next.to}`,
      context: { user, retryCount: 0 },
    };
  };
}

/** Re-enters the task while retries remain, then fails the run with the actor's error. */
function recovery(machine: Machine.Any, task: Task.Any) {
  return ({ context, event }: { context: Runtime; event: ErrorActorEvent }) =>
    context.retryCount < machine.retries
      ? {
          target: `#${machine.id}.${task.name}`,
          reenter: true,
          context: { retryCount: context.retryCount + 1 },
        }
      : { target: `#${machine.id}.${Failed}`, context: { error: event.error } };
}

function invocation(machine: Machine.Any, task: Task.Any, assignment: Assignment.Any) {
  return {
    src: assignment.actor.name,
    input: ({ context }: { context: Runtime }) => invocationInput(assignment, context),
    onDone: completion(machine, task, assignment),
    onError: recovery(machine, task),
  };
}

function compileSingleTask(machine: Machine.Any, task: Task.Any) {
  const assignment = task.assignments[0];
  if (assignment === undefined) {
    throw new Error(`Task "${task.name}" has no actor assignment.`);
  }

  return {
    id: task.name,
    invoke: invocation(machine, task, assignment),
  };
}

function compileMultiTask(machine: Machine.Any, task: Task.Any) {
  const assignments = Object.fromEntries(
    task.assignments.map((assignment, index) => [
      `assignment-${index}`,
      { invoke: invocation(machine, task, assignment) },
    ])
  );

  return {
    id: task.name,
    initial: "select",
    states: {
      select: {
        always: ({ context }: { context: Runtime }) => {
          const index = task.assignments.findIndex((assignment: Assignment.Any) =>
            assignment.enabled({ ...invocationInput(assignment, context), signal: selectionSignal })
          );
          if (index === -1) {
            throw new Error(`Task "${task.name}" has no enabled assignment for this context.`);
          }

          return { target: `assignment-${index}` };
        },
      },
      ...assignments,
    },
  };
}

function compileTasks(machine: Machine.Any) {
  return Object.fromEntries(
    machine.tasks.map((task: Task.Any) => {
      if (isSink(task)) return [task.name, { id: task.name, type: "final" as const }];
      if (task.assignments.length === 0) {
        throw new Error(`Task "${task.name}" has no actor assignment.`);
      }

      return [
        task.name,
        task.assignments.length === 1
          ? compileSingleTask(machine, task)
          : compileMultiTask(machine, task),
      ];
    })
  );
}
