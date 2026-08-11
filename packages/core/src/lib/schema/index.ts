import type { StandardSchemaV1, StandardJSONSchemaV1 } from "@standard-schema/spec";
import { isTypeboxSchema, typebox } from "./typebox.ts";
import { isValibotSchema, valibot } from "./valibot.ts";

export type ForgeSchema<I = unknown, O = I> = StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O>;

function hasJsonSchema(schema: StandardSchemaV1): schema is ForgeSchema {
  return "jsonSchema" in schema["~standard"];
}

/**
 * Upgrades a Standard Schema to a JSON-Schema-capable Forge schema: already
 * capable schemas pass through, known vendors (valibot, typebox) are upgraded
 * in place, anything else fails at definition time. Effect schemas are not
 * natively Standard Schema compatible — bring those through `schema()` from
 * `@forge/core/schema/effect`.
 */
export function getJsonSchema<I, O>(schema: StandardSchemaV1<I, O>): ForgeSchema<I, O> {
  if (hasJsonSchema(schema)) return schema as ForgeSchema<I, O>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- upgrades preserve I/O
  if (isValibotSchema(schema)) return valibot(schema) as unknown as ForgeSchema<I, O>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- upgrades preserve I/O
  if (isTypeboxSchema(schema)) return typebox(schema) as unknown as ForgeSchema<I, O>;

  throw new Error(
    "This schema does not support JSON Schema generation. " +
      "Use a natively capable schema (valibot, typebox) or a @forge/core schema adapter."
  );
}
