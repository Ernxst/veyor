import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Machine } from "@forge/core";
import type { DeliveryBlueprint } from "../src/machine.ts";
import type * as Schema from "../src/schema.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    budget: { type: "string", default: "25" },
    backlog: { type: "string" },
    decisions: { type: "string" },
    factory: { type: "string" },
    headless: { type: "boolean", default: false },
  },
});

const prompt = positionals.at(0);
if (prompt === undefined) {
  console.error(
    'Usage: bun scripts/deliver.ts "<task>" [--budget 25] [--backlog items.json] [--decisions decisions.json] [--headless | --factory <name>]'
  );
  process.exit(1);
}

// Caller-supplied JSON is validated by the machine's context contract on run.
/** A caller that already knows the decomposition supplies it; plan adopts it for free. */
// oxlint-disable-next-line typescript/no-unsafe-assignment
const planned: readonly Schema.PlannedItem[] =
  values.backlog === undefined ? [] : JSON.parse(readFileSync(values.backlog, "utf8"));

/** Answers from a previous run (or the caller's own knowledge), pre-seeded. */
// oxlint-disable-next-line typescript/no-unsafe-assignment
const decisions: Schema.Context["decisions"] =
  values.decisions === undefined ? [] : JSON.parse(readFileSync(values.decisions, "utf8"));

// --factory names any module in src/factories (e.g. an untracked local one);
// --headless is shorthand for the policy-authority assembly.
const assembly = values.factory ?? (values.headless ? "headless" : "llm");
type Assembly = { default: Machine.Impl<typeof DeliveryBlueprint> };
// oxlint-disable-next-line typescript/no-unsafe-assignment -- typed on the next line
const imported = await import(`../src/factories/${assembly}.ts`);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every assembly implements the blueprint
const factory = (imported as Assembly).default;

// Progress on stderr; the JSON result owns stdout.
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

const observer = (event: Machine.RunEvent): void =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- discriminated dispatch
  console.error((render[event.type] as (event: Machine.RunEvent) => string)(event));

const result = await factory.run(
  {
    input: { prompt, files: [] },
    backlog: planned.map((item) => ({ ...item, status: "pending" as const })),
    planVersion: 0,
    attempts: 0,
    unverifiedRisk: 0,
    itemSpend: 0,
    reworked: false,
    findings: [],
    spend: 0,
    spendBudget: Number(values.budget),
    decisions,
    reviewHistory: [],
  },
  { observer }
);

// Machine-readable for an agent caller; readable enough for a human.
console.log(
  JSON.stringify(
    {
      task: result.task,
      planVersion: result.context.planVersion,
      spend: result.context.spend,
      spendBudget: result.context.spendBudget,
      integrated: result.context.backlog
        .filter((item) => item.status === "integrated")
        .map((item) => item.id),
      deferred: result.context.backlog
        .filter((item) => item.status !== "integrated")
        .map((item) => ({ id: item.id, status: item.status, objective: item.objective })),
      decisions: result.context.decisions,
      reviewHistory: result.context.reviewHistory,
    },
    null,
    2
  )
);

process.exit(result.task === "done" ? 0 : 1);
