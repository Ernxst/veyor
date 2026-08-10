import { describe, expect, it } from "vitest";
import { question, review } from "./prompt.ts";

describe(".question", () => {
  it("returns an answered outcome", () => {
    expect(question().parse(" yes ", { question: "Continue?" })).toStrictEqual({
      outcome: "answered",
      answer: "yes",
    });
  });
});

describe(".review", () => {
  it("returns the selected outcome", () => {
    expect(review().parse("continue looks good", { summary: "Review" })).toStrictEqual({
      outcome: "continue",
      notes: "looks good",
    });
  });

  it("omits empty notes", () => {
    expect(review().parse("abandon", { summary: "Review" })).toStrictEqual({
      outcome: "abandon",
    });
  });
});
