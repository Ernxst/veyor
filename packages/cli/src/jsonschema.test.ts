import { describe, expect, it } from "vitest";
import { kindAt } from "./jsonschema.ts";

const root = {
  $defs: {
    Item: { type: "object", properties: { id: { type: "string" } } },
  },
  type: "object",
  properties: {
    input: {
      type: "object",
      properties: {
        task: { type: "string" },
        files: { type: "array", items: { type: "string" } },
      },
    },
    spendBudget: { type: "number" },
    attempts: { type: "integer" },
    headless: { type: "boolean" },
    backlog: { type: "array", items: { $ref: "#/$defs/Item" } },
    item: { $ref: "#/$defs/Item" },
    tier: { anyOf: [{ const: "gate" }, { const: "standard" }] },
    status: { enum: ["pending", "integrated"] },
    maybe: { type: ["string", "null"] },
  },
};

describe("kindAt", () => {
  it("reads primitive kinds at nested paths", () => {
    expect(kindAt(root, ["input", "task"])).toBe("string");
    expect(kindAt(root, ["spendBudget"])).toBe("number");
    expect(kindAt(root, ["attempts"])).toBe("integer");
    expect(kindAt(root, ["headless"])).toBe("boolean");
  });

  it("treats structures as json", () => {
    expect(kindAt(root, ["input", "files"])).toBe("json");
    expect(kindAt(root, ["backlog"])).toBe("json");
  });

  it("resolves $ref pointers", () => {
    expect(kindAt(root, ["item", "id"])).toBe("string");
  });

  it("derives kinds from const and enum unions", () => {
    expect(kindAt(root, ["tier"])).toBe("string");
    expect(kindAt(root, ["status"])).toBe("string");
  });

  it("ignores null arms of nullable types", () => {
    expect(kindAt(root, ["maybe"])).toBe("string");
  });

  it("is unknown off the map", () => {
    expect(kindAt(root, ["missing", "path"])).toBe("unknown");
  });
});
