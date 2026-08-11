# `@veyor/opencode`

`@veyor/opencode` runs a Veyor actor through the local [opencode](https://opencode.ai) CLI in non-interactive mode (`opencode run`), giving Veyor factories access to every provider opencode is authenticated with — including its free model tier.

> [!IMPORTANT]
> This package is under active development. It is private, remains at `0.0.0`, and is not published to a package registry.

```ts
import { opencode } from "@veyor/opencode";
import { Implementer } from "./actors.js";

const ImplementerImpl = opencode(Implementer, "opencode/deepseek-v4-flash-free", {
  instructions: "Execute only the assigned backlog item.",
});
```

Models are addressed as `provider/model`, exactly as `opencode run --model` expects. Options: `instructions` (prepended to the prompt), `cwd`, and `agent` (a named opencode agent configuration).

Unlike the Claude Code and Codex adapters, opencode has no schema-enforced output. The actor's output contract is stated in the prompt, extracted from the response (fenced or bare), and validated against the contract — a validation failure throws, which lands in the machine's retry policy. Cheap models plus contract validation plus retries is exactly the failure mode Veyor is built to absorb, which makes this adapter a good fit for low-cost dry runs of an otherwise expensive assembly.
