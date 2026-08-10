import factory from "../src/factories/probabilistic.ts";
import type * as Schema from "../src/schema.ts";

const RUNS = 10_000;

const context: Schema.Context = {
  input: { prompt: "Ship the typed workflow runner", files: [] },
  backlog: [],
  planVersion: 0,
  attempts: 0,
  findings: [],
  spend: 0,
  spendBudget: 25,
  decisions: [],
  reviewHistory: [],
};

const sinks = new Map<string, number>();
const failures = new Map<string, number>();
let spendTotal = 0;
let integratedTotal = 0;
let planTotal = 0;
let finished = 0;

for (let seed = 1; seed <= RUNS; seed++) {
  try {
    const result = await factory(seed * 1000).run(context);
    sinks.set(result.task, (sinks.get(result.task) ?? 0) + 1);
    spendTotal += result.context.spend;
    integratedTotal += result.context.backlog.filter((i) => i.status === "integrated").length;
    planTotal += result.context.planVersion;
    finished++;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.set(reason, (failures.get(reason) ?? 0) + 1);
  }
}

console.log(`${RUNS} seeded runs of "software-delivery-factory" (budget ${context.spendBudget})\n`);

for (const [sink, count] of [...sinks.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sink.padEnd(12)} ${percent(count)}  (${count})`);
}

const failed = [...failures.values()].reduce((sum, count) => sum + count, 0);
if (failed > 0) {
  console.log(`  ${"failed".padEnd(12)} ${percent(failed)}  (${failed}) — retries exhausted`);
  for (const [reason, count] of [...failures.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${count}× ${reason}`);
  }
}

if (finished > 0) {
  console.log(
    `\n  mean spend ${(spendTotal / finished).toFixed(1)}, ` +
      `mean items integrated ${(integratedTotal / finished).toFixed(1)} of 6, ` +
      `mean plans per run ${(planTotal / finished).toFixed(2)}`
  );
}

function percent(count: number): string {
  return `${((100 * count) / RUNS).toFixed(1).padStart(5)}%`;
}
