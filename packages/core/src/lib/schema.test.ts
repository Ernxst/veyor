// @effect-diagnostics asyncFunction:off
import { Type } from "@sinclair/typebox";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import * as Schema from "effect/Schema";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { schema as effectSchema } from "./schema/effect.ts";
import { getJsonSchema } from "./schema/index.ts";
import { typebox } from "./schema/typebox.ts";
import { valibot } from "./schema/valibot.ts";
import { validate } from "./schema/validate.ts";

describe("schema adapters", () => {
  it("validates Effect schemas and exposes their output JSON Schema", async () => {
    const contract = effectSchema(Schema.Struct({ name: Schema.String }));

    await expect(validate(contract, { name: "Veyor" }, "input", "writer")).resolves.toStrictEqual({
      name: "Veyor",
    });
    await expect(validate(contract, { name: 1 }, "input", "writer")).rejects.toThrow(
      'The input for "writer" does not match its schema: {"name":1}'
    );
    expect(contract["~standard"].jsonSchema.output({ target: "draft-2020-12" })).toMatchObject({
      properties: { name: { type: "string" } },
      required: ["name"],
      type: "object",
    });
  });

  it("adapts TypeBox schemas for validation and JSON Schema generation", async () => {
    const contract = typebox(Type.Object({ attempts: Type.Integer({ minimum: 0 }) }));

    await expect(validate(contract, { attempts: 2 }, "context", "factory")).resolves.toStrictEqual({
      attempts: 2,
    });
    await expect(validate(contract, { attempts: -1 }, "context", "factory")).rejects.toThrow(
      'The context for "factory" does not match its schema: {"attempts":-1}'
    );
    expect(contract["~standard"].jsonSchema.output({ target: "draft-2020-12" })).toMatchObject({
      properties: { attempts: { minimum: 0, type: "integer" } },
      type: "object",
    });
  });

  it("upgrades native Valibot and TypeBox contracts at the JSON Schema boundary", async () => {
    const valibotContract = getJsonSchema(v.object({ name: v.string() }));
    // @ts-expect-error TypeBox supports Standard Schema at runtime but omits it from this type.
    const typeboxContract = getJsonSchema(Type.Object({ name: Type.String() }));

    await expect(
      validate(valibotContract, { name: "Veyor" }, "input", "writer")
    ).resolves.toStrictEqual({
      name: "Veyor",
    });
    await expect(
      validate(typeboxContract, { name: "Veyor" }, "input", "writer")
    ).resolves.toStrictEqual({
      name: "Veyor",
    });
    expect(
      valibotContract["~standard"].jsonSchema.output({ target: "draft-2020-12" })
    ).toMatchObject({
      properties: { name: { type: "string" } },
      type: "object",
    });
    expect(
      typeboxContract["~standard"].jsonSchema.output({ target: "draft-2020-12" })
    ).toMatchObject({
      properties: { name: { type: "string" } },
      type: "object",
    });
  });

  it("keeps the direct Valibot adapter JSON-Schema-capable", () => {
    // @ts-expect-error The adapter must accept ordinary Valibot object schemas, not just AnySchema.
    const contract = valibot(v.object({ enabled: v.boolean() }));

    expect(contract["~standard"].jsonSchema.output({ target: "draft-2020-12" })).toMatchObject({
      properties: { enabled: { type: "boolean" } },
      type: "object",
    });
  });

  it("rejects Standard Schema contracts that cannot generate JSON Schema", () => {
    const unsupported: StandardSchemaV1 = {
      "~standard": {
        vendor: "test",
        version: 1,
        validate: () => ({ value: undefined }),
      },
    };

    expect(() => getJsonSchema(unsupported)).toThrow(
      "This schema does not support JSON Schema generation."
    );
  });
});
