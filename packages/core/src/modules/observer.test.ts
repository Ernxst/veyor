import { describe, expect, it } from "vitest";
import { textObserver } from "./observer.ts";

describe("textObserver", () => {
  it("renders one line per event", () => {
    const lines: string[] = [];
    const observe = textObserver((line) => lines.push(line));

    observe({ type: "invoke", task: "plan", actor: "planner" });
    observe({
      type: "complete",
      task: "plan",
      actor: "planner",
      outcome: "planned",
      durationMs: 1500,
    });
    observe({ type: "transition", from: "plan", to: "select" });
    observe({ type: "retry", task: "plan", attempt: 2 });
    observe({
      type: "error",
      task: "plan",
      actor: "planner",
      error: new Error("boom"),
      durationMs: 20,
    });

    expect(lines).toStrictEqual([
      "▸ plan · planner",
      "  ✓ planned (1.5s)",
      "  → select",
      "  ↻ retry #2",
      "  ✗ boom",
    ]);
  });
});
