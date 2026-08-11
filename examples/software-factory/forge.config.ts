import { defineConfig } from "@forge/cli";
import headless from "./src/factories/headless.ts";
import llm from "./src/factories/llm.ts";
import local from "./src/factories/local.ts";
import probabilistic from "./src/factories/probabilistic.ts";

export default defineConfig({
  name: "software-factory",
  description: "Deliver a task through a verified assembly line",
  assemblies: { llm, headless, local, probabilistic },
  args: [
    { key: "input.prompt", position: 0, description: "What to deliver" },
    { key: "spendBudget", name: "budget", description: "Model-grade call budget" },
    {
      key: "backlog",
      from: "file",
      description: "Caller-supplied decomposition; the plan station adopts it for free",
    },
    {
      key: "decisions",
      from: "file",
      description: "Answers from a previous run, pre-seeded",
    },
  ],
  run: { assembly: "llm", success: "done" },
  examples: [
    {
      command:
        'forge run "Write a haiku file" --assembly local --backlog fixtures/haiku.json --budget 5',
      description: "Degenerate case: a trivial caller-supplied item, one model-grade call",
    },
    {
      command: 'forge run "Ship dark mode" --assembly headless --budget 25',
      description: "Unattended delivery with policy authorities",
    },
    {
      command: 'forge simulate "Ship the typed workflow runner" --runs 10000',
      description: "Monte Carlo over the seeded probabilistic assembly",
    },
  ],
});
