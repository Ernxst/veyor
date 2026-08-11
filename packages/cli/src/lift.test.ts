import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { buildArgs, contextFrom } from "./lift.ts";

const contextSchema = {
  type: "object",
  properties: {
    request: {
      type: "object",
      properties: {
        title: { type: "string" },
        options: {
          type: "object",
          properties: { dryRun: { type: "boolean" } },
        },
      },
    },
  },
};

describe("CLI context lifting", () => {
  it("deep-merges declared values over context while preserving unrelated siblings", () => {
    const args = buildArgs(
      {
        assemblies: {},
        args: [
          { key: "request.title", name: "title" },
          { key: "request.options.dryRun", name: "dry-run" },
        ],
      },
      contextSchema
    );

    const result = contextFrom(
      args,
      { title: Option.some("Ship CLI contracts"), "dry-run": Option.some(true) },
      {
        request: { title: "old title", options: { retries: 3 }, owner: "release" },
        trace: { source: "fixture" },
      }
    );

    expect(result).toStrictEqual({
      request: {
        title: "Ship CLI contracts",
        options: { retries: 3, dryRun: true },
        owner: "release",
      },
      trace: { source: "fixture" },
    });
  });

  it("rejects a context file value that cannot be an object", () => {
    const result = contextFrom([], {}, ["not", "a", "context"]);

    expect(result).toMatchObject({ message: "--context: expected the file to hold an object." });
  });
});
