import { describe, expect, it, vi } from "vitest";
import { textObserver } from "./observer.ts";

describe("textObserver", () => {
  it("renders one line per event", () => {
    const write = vi.fn();
    const observe = textObserver(write);

    observe({ type: "invoke", task: "plan", actor: "planner", input: {} });
    observe({
      type: "complete",
      task: "plan",
      actor: "planner",
      outcome: "planned",
      output: { outcome: "planned" },
      durationMs: 1500,
    });
    observe({ type: "transition", from: "plan", to: "select" });
    observe({ type: "retry", task: "plan", attempt: 2 });
    observe({ type: "activity", task: "plan", actor: "planner", detail: "checking files" });
    observe({
      type: "error",
      task: "plan",
      actor: "planner",
      error: new Error("boom"),
      durationMs: 20,
    });

    expect(write).toHaveBeenCalledTimes(6);
    expect(write).toHaveBeenNthCalledWith(1, "▸ plan · planner");
    expect(write).toHaveBeenNthCalledWith(2, "  ✓ planned (1.5s)");
    expect(write).toHaveBeenNthCalledWith(3, "  → select");
    expect(write).toHaveBeenNthCalledWith(4, "  ↻ retry #2");
    expect(write).toHaveBeenNthCalledWith(5, "    · checking files");
    expect(write).toHaveBeenNthCalledWith(6, "  ✗ boom");
  });
});
