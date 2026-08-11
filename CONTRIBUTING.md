# Contributing

## Prerequisites

- Bun and Node.js versions declared in [AGENTS.md](./AGENTS.md)
- A Chromium-based browser

## Setup

```bash
bun install --frozen-lockfile
bun run dev
```

## Commit discipline

- **One logical change per commit** — feature, fix, refactor, docs, or chore
- **Never `git add -A`** — stage specific files only
- **Every commit** should be atomic, verifiable, reviewable, revertable.
- Commit after each complete, verified logical change; do not defer all commits until the end of a task.
- **Co-author required** — include the model/agent name if known (e.g. "Claude Sonnet 4")
- **Never combine `git add` and `git commit` in one command.** Always run them as separate commands.

### Commit message

```
type(scope): description

<OPTIONAL BODY>

Co-authored-by: Model Name <email@example.com>
```

- Generate message **only from `git diff`** — not from memory, chat, or assumptions
- Review the **full** `git diff` including all staged files. Do not anchor on a subset of changes when composing the message.
- Body optional — add it only when explaining _why_ (not _what_), non-obvious bugs, or trade-offs
  - Add a body when the summary does not completely capture the entire reason for the commit
- Co-author matches the actual model/agent from your session. Omit if unknown.
- If closing an issue, a body is required:

```
Closes #ISSUE_NUMBER
```

With the preceding hashtag.

### Diff summaries

When summarising changes, summarise the actual diff only.

Required process:

1. Use `git diff --cached` for staged changes.
2. Compare against the correct base, not the worktree or memory.
3. Do not infer capabilities from file names, class names, or architecture shape.
4. Treat moved/renamed/extracted code as refactor unless behaviour changed.
5. Distinguish clearly between:
   - added behaviour
   - removed behaviour
   - refactored existing behaviour
   - renamed/moved code
   - cleanup/dead-code removal
6. Do not claim something is “new”, “now supports”, or “enables” unless the diff proves it was impossible before.
7. Prefer boring accuracy over architectural narrative.
8. If unsure whether something already existed, say so instead of guessing.

Output format:

- Start with a one-sentence summary of the real delta.
- Then list concrete changes grouped by kind.
- Avoid future-roadmap language unless the diff directly adds future-facing API surface.

Before summarising, verify each claim against added/removed lines in the diff. Unsupported claims must be omitted.

### Never do

- `git add -A`
- Stage + commit in same command (`git add . && git commit`)
- Mix unrelated files in one commit
- Generate commit message from memory or chat — use `git diff` only
- Commit non-project/throwaway files (e.g. `GPT.md`, `.cursor/`, personal notes)

### Commit Flow

1. `git status` — check what changed
2. `git diff` / `git diff --staged` — review changes
3. `git add <specific-files>` — stage ONLY the files (never `-A`)
4. `git commit` — separate command from add

## Pull requests

1. Open an issue first (unless it's a trivial fix) to discuss the approach.
2. Keep dependent implementation on one draft pull request. Split work only when it is independently reviewable and revertible.
3. Follow the [pull request evidence policy](./docs/review/pr-evidence.md) and include every required section in the pull request description.
4. Do not open a PR with a custom body that skips the required evidence sections.
5. In `## Summary`, explain the change in terms of behaviour, intent, and why it matters — do not just restate the diff.
6. Put verification evidence and reviewer-facing explanations directly on the pull request.
7. Resolve review findings, re-run the relevant verification, and request re-review of the exact head before merging.
8. Do not use a closing keyword for an epic unless the pull request completes the entire epic.

## Issue readiness

Every issue defines its observable success condition, verification layer, dependencies, and required human input before implementation begins.

Use the Agent task issue form for bounded implementation work intended to receive `ready-for-agent`. Use the bug and feature forms for initial reports and product discussion.

- `ready-for-agent` — fully specified and executable without further human input
- `ready-for-human` — awaiting judgement, access, direction, or manual validation
- `blocked` — cannot proceed until a named dependency or condition is resolved

Replace the previous state label when an issue changes state. State labels describe actionability; type and area labels describe the work.

## Labelling issues

Never file an issue bare. Every issue gets **at least one type label**, plus a **grouping/area label where one fits**.

**Type labels** (what kind of work — pick ≥1):

- `bug` — something is broken (default for defects)
- `enhancement` — new feature or request (default for features / UX)
- `perf` — performance / efficiency
- `test-infra` — testing infrastructure / conventions
- `documentation` — documentation changes
- `structure` — file organisation / conventions
- `simplify` — reduce complexity without behaviour change
- `reuse` — consolidate duplication / reuse existing code
- `a11y` — accessibility
- `question` — a question, not actionable work yet

**Grouping / area labels** (add where applicable):

- `epic` — large multi-issue initiative
- `deferred` — backlog / not scheduled yet
- `observability` — logging, tracing, metrics, error reporting
- `a11y` — accessibility

Opening an issue through the [issue forms](./.github/ISSUE_TEMPLATE) applies the type label and marks it `ready-for-human` for triage. Add any further type or grouping labels by hand.

## Questions?

Open an [issue](https://github.com/Ernxst/veyor/issues).
