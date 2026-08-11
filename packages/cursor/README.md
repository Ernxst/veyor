# `@veyorhq/cursor`

`@veyorhq/cursor` runs a Veyor actor through the local [Cursor Agent CLI](https://cursor.com/docs/cli) (`cursor-agent`) in non-interactive print mode (`cursor-agent -p`), giving Veyor factories access to whatever model your Cursor account is authenticated for.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

```ts
import { cursor } from "@veyorhq/cursor";
import { Implementer } from "./actors.js";

const ImplementerImpl = cursor(Implementer, "sonnet-4-thinking", {
  instructions: "Execute only the assigned backlog item.",
});
```

Models are passed straight through to `cursor-agent --model`. Options: `instructions` (prepended to the prompt), `cwd` (passed as `--workspace`), and `ceilingMs`.

Like `@veyorhq/opencode`, cursor-agent has no schema-enforced output mode. The actor's output contract is stated in the prompt, extracted from the response (fenced or bare), and validated against the contract — a validation failure throws, which lands in the machine's retry policy.

`cursor-agent` requires an authenticated session (`cursor-agent login`) or a `CURSOR_API_KEY` environment variable; this adapter does not manage authentication itself and assumes the ambient environment is already authenticated, exactly as `@veyorhq/opencode` assumes `opencode` is. See the `cursor-adapter-gotchas` skill for exactly which CLI behaviors this adapter's design was verified against versus inferred from `--help`/docs.

When every actor in an assembly shares the same model and working directory, capture that once with `cursor.preset(...)` instead of hand-rolling a wrapper that injects `cwd`:

```ts
import { cursor } from "@veyorhq/cursor";
import { Implementer } from "./actors.js";

const worker = cursor.preset({
  model: "sonnet-4-thinking",
  cwd: "/tmp/veyor-voyage",
});

const ImplementerImpl = worker(Implementer, {
  instructions: "Execute only the assigned backlog item.",
});
```

`cursor.preset` is sugar over `cursor` — per-call options (including `model`) shallow-merge over the preset, with the per-call value winning.
