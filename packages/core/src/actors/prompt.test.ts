import { describe, expect, it } from "vitest";
import { acceptance, question, review } from "./prompt.ts";

describe(".question", () => {
  it("renders an open question", () => {
    expect(question().render({ question: "Continue?" })).toBe("Continue?\n> ");
  });

  it("renders numbered choices", () => {
    expect(question().render({ question: "Continue?", options: ["yes", "no"] })).toBe(
      "Continue?\n  1) yes\n  2) no\n> "
    );
  });

  it("returns an answered outcome", () => {
    expect(question().parse(" yes ", { question: "Continue?" })).toStrictEqual({
      outcome: "answered",
      answer: "yes",
    });
  });

  it("resolves listed answers by number or case-insensitive text", () => {
    const format = question();
    const prompt = { question: "Continue?", options: ["Continue", "Abandon"] };

    expect(format.parse("2", prompt)).toStrictEqual({ outcome: "answered", answer: "Abandon" });
    expect(format.parse(" continue ", prompt)).toStrictEqual({
      outcome: "answered",
      answer: "Continue",
    });
  });

  it("rejects an answer outside the listed choices", () => {
    expect(() =>
      question().parse("later", { question: "Continue?", options: ["yes", "no"] })
    ).toThrow("Enter a number or option from this list: yes, no.");
  });
});

describe(".acceptance", () => {
  it("renders the summary and decision vocabulary", () => {
    expect(acceptance().render({ summary: "All checks passed" })).toBe(
      "All checks passed\n\naccept or reject?\n> "
    );
  });

  it("parses both verdicts and preserves notes", () => {
    const format = acceptance();

    expect(format.parse("ACCEPT ship it", { summary: "All checks passed" })).toStrictEqual({
      outcome: "accepted",
      notes: "ship it",
    });
    expect(format.parse(" reject ", { summary: "All checks passed" })).toStrictEqual({
      outcome: "rejected",
    });
  });

  it("rejects an unrecognised verdict", () => {
    expect(() => acceptance().parse("defer", { summary: "All checks passed" })).toThrow(
      'Enter "accept" or "reject".'
    );
  });
});

describe(".review", () => {
  it("renders a review without a diff", () => {
    expect(review().render({ summary: "Review" })).toBe("Review\n\ncontinue or abandon?\n> ");
  });

  it("renders a supplied diff between the summary and decision", () => {
    expect(review().render({ summary: "Review", diff: "- old\n+ new" })).toBe(
      "Review\n\n- old\n+ new\n\ncontinue or abandon?\n> "
    );
  });

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

  it("rejects an unrecognised review outcome", () => {
    expect(() => review().parse("pause", { summary: "Review" })).toThrow(
      'Enter "continue" or "abandon".'
    );
  });
});
