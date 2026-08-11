# `@veyorhq/anthropic`

`@veyorhq/anthropic` provides Anthropic-backed implementations for Veyor actors.

It exposes two separate adapters:

- `@veyorhq/anthropic/anthropic` creates an Effect AI model layer for `@veyorhq/ai-effect`.
- `@veyorhq/anthropic/claude` runs a Veyor actor through the local Claude Code CLI in headless mode.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

## Anthropic API

Use `anthropic(model)` with `agent(...)` when the actor should call the Anthropic API through Effect AI.

```ts
import { agent } from "@veyorhq/ai-effect";
import { anthropic } from "@veyorhq/anthropic/anthropic";
import { Writer } from "./actors.js";

const WriterImpl = agent(Writer, anthropic("claude-opus-5"), {
  prompt: "Return a concise implementation plan.",
});
```

The adapter reads `ANTHROPIC_API_KEY` through Effect `Config`. Missing or invalid configuration fails when the model layer is used.

## Claude Code CLI

Use `claude(actor, model, options)` when a Claude Code session should implement the actor. The adapter drives the CLI's supported headless mode (`claude --print`) with your own local authentication, passes the actor's output contract via `--json-schema`, and validates the structured result.

```ts
import { claude } from "@veyorhq/anthropic/claude";
import { Reviewer } from "./actors.js";

const ReviewerImpl = claude(Reviewer, "claude-opus-5", {
  effort: "high",
  cwd: process.cwd(),
  permissionMode: "dontAsk",
  instructions: "Review the assignment against its acceptance criteria.",
});
```

Options map onto CLI flags: `effort`, `instructions` (`--append-system-prompt`), `permissionMode`, `allowedTools`/`disallowedTools`, `maxBudgetUsd`, and `cwd`. Sessions run with `--no-session-persistence`; each invocation is a fresh, single-shot worker.

When several actors share the same model, effort, and permission mode, capture that once with `claude.preset(...)` instead of repeating it per actor:

```ts
import { claude } from "@veyorhq/anthropic/claude";
import { Reviewer } from "./actors.js";

const reviewWorker = claude.preset({
  model: "claude-opus-5",
  effort: "high",
  permissionMode: "dontAsk",
});

const ReviewerImpl = reviewWorker(Reviewer, {
  instructions: "Review the assignment against its acceptance criteria.",
});
```

`claude.preset` is sugar over `claude` — per-call options (including `model`) shallow-merge over the preset, with the per-call value winning.
