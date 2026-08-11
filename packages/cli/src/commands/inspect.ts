import { isSink, type Machine, type Task } from "@veyor/core";
import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { blueprintOf, type VeyorConfig } from "../config.ts";

export function makeInspect(config: VeyorConfig) {
  return Command.make(
    "inspect",
    {
      mermaid: Flag.boolean("mermaid").pipe(
        Flag.withDescription("Emit a Mermaid state diagram instead of text"),
        Flag.optional
      ),
    },
    ({ mermaid }) =>
      Effect.gen(function* () {
        const machine = blueprintOf(config);
        const lines =
          Option.getOrUndefined(mermaid) === true ? toMermaid(machine) : toText(machine);
        yield* Console.log(lines.join("\n"));
      })
  ).pipe(Command.withDescription("Print the blueprint: stations, actors, and transitions"));
}

function toText(machine: Machine.Any): string[] {
  const header = `${machine.id} · initial: ${machine.initial} · retries: ${machine.retries}`;
  const stations = machine.tasks
    .filter((task: Task.Any) => !isSink(task))
    .flatMap((task: Task.Any) => stationLines(task, machine));
  const sinks = machine.tasks.filter((task: Task.Any) => isSink(task)).map((task) => task.name);

  return [header, "", ...stations, "", `sinks: ${sinks.join(", ")}`];
}

function stationLines(task: Task.Any, machine: Machine.Any): string[] {
  const actors = task.assignments.map((assignment) => `  · ${assignment.actor.name}`);
  const routes = machine.transitions
    .filter((transition) => transition.from === task.name)
    .map((transition) => `  → ${transition.to} on ${transition.on}${guardNote(transition)}`);

  return [task.name, ...actors, ...routes];
}

function guardNote(transition: Machine.Any["transitions"][number]): string {
  return transition.when === undefined ? "" : " (guarded)";
}

function toMermaid(machine: Machine.Any): string[] {
  const lines = ["stateDiagram-v2", `  [*] --> ${machine.initial}`];

  for (const transition of machine.transitions) {
    lines.push(`  ${transition.from} --> ${transition.to} : ${transition.on}`);
  }
  for (const task of machine.tasks) {
    if (isSink(task)) lines.push(`  ${task.name} --> [*]`);
  }

  return lines;
}
