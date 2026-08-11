# Reproducible runs

Scenarios for exercising the delivery factory on real models, ordered so each run tests one mechanism the Monte Carlo simulation cannot. All commands run from the example root. The `local` assembly uses opencode's free model tier and confines workers to an isolated workspace (`VEYOR_WORKSPACE`, default `/tmp/veyor-voyage`) — agentic workers never act inside this repository.

## 1. Degenerate case — the zero-overhead floor

A caller-supplied trivial item: adopted for free, one implement call, gate review, gate verify, auto-accept. No prompts should appear and the result should report `"spend": 1`.

```sh
bun run veyor run "Write a haiku file" --assembly local --backlog fixtures/haiku.json --budget 5
```

Watch for: a retry here means the model failed contract validation on its first try — visible as latency, absorbed by the machine.

## 2. Small real plan — does the planner plan?

No backlog: the model planner decomposes, and the granularity instruction gets its first real test.

```sh
bun run veyor run "Create a tiny static site: an index.html, a styles.css, and an about page, linked together" --assembly local --budget 15
```

Watch for: backlog size (3–4 items is right; 7 means the ceremony instruction lost), sensible `dependsOn`, and trivial items routing through the free gate reviewer.

## 3. Ambiguity bait — the blocked → ask-user path

Deliberately underspecified. A good worker raises `blocked` rather than guessing; the question arrives at your terminal and your answer lands in `decisions` for every later worker.

```sh
bun run veyor run "Write a config file for the deployment" --assembly local --budget 8
```

Watch for: whether `blocked` actually fires — cheap models may just guess, which is a finding about the tier, not the machine.

## 4. Review churn — bounded refinement and rework under real findings

Acceptance criteria strict enough that review plausibly rejects; medium risk keeps it off the gate tier.

```sh
bun run veyor run "Deliver a robust CSV parser" --assembly local --backlog fixtures/csv-parser.json --budget 10
```

Watch for: `reviewHistory` attempts climbing, a rework firing at three failed refines (a fresh senior-tier implementation), and `itemSpend` capping before the run budget drains.

## 5. Budget squeeze — the funding boundary

Budget 3 against a multi-file task: the spend guard bounces the run into `user-review` mid-delivery. Answer `continue` once (authorises another tranche), then `defer` on the next squeeze to see partial delivery in the result's `deferred` array.

```sh
bun run veyor run "Create three markdown files: todo.md, done.md, ideas.md, each with a heading" --assembly local --budget 3
```

## 6. The agent loop, played by hand

Re-run any deferred scenario with its questions answered — this is exactly what an agent caller does with `--headless`; you are just being the agent.

```sh
echo '[{ "question": "<from the previous result decisions log>", "answer": "<your answer>" }]' > /tmp/veyor-voyage/answers.json
bun run veyor run "<same task>" --assembly local --decisions /tmp/veyor-voyage/answers.json --budget 8
```

## Afterwards, note down

- Contract-validation failure rate per station (visible as retries) — decides whether the free tier needs stronger prompts or the adapter needs a repair pass.
- Whether `blocked`/`contradiction` ever fire on cheap models — calibrates what the ambient outcomes are worth per tier.
- Which station felt slowest — the first candidate for a real model when graduating from the free tier.
