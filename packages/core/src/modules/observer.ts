import type { Machine } from "./machine.ts";

const render: {
  [T in Machine.RunEvent["type"]]: (event: Extract<Machine.RunEvent, { type: T }>) => string;
} = {
  invoke: (event) => `▸ ${event.task} · ${event.actor}`,
  complete: (event) => `  ✓ ${event.outcome} (${(event.durationMs / 1000).toFixed(1)}s)`,
  transition: (event) => `  → ${event.to}`,
  retry: (event) => `  ↻ retry #${event.attempt}`,
  error: (event) =>
    `  ✗ ${event.error instanceof Error ? event.error.message : String(event.error)}`,
};

/**
 * The default run renderer: one line per event, written via `write`
 * (stderr by default, leaving stdout free for the run's result).
 */
export function textObserver(
  // @effect-diagnostics-next-line globalConsole:off -- stderr is this observer's default sink
  write: (line: string) => void = (line) => console.error(line)
): (event: Machine.RunEvent) => void {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- discriminated dispatch
  return (event) => write((render[event.type] as (event: Machine.RunEvent) => string)(event));
}
