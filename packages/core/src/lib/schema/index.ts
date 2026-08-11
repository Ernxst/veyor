import type { StandardSchemaV1, StandardJSONSchemaV1 } from "@standard-schema/spec";
import { isTypeboxSchema, typebox } from "./typebox.ts";
import { isValibotSchema, valibot } from "./valibot.ts";

export type VeyorSchema<I = unknown, O = I> = StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O>;

function hasJsonSchema(schema: StandardSchemaV1): schema is VeyorSchema {
  const standard: unknown = schema["~standard"];
  return typeof standard === "object" && standard !== null && "jsonSchema" in standard;
}

/**
 * Upgrades a Standard Schema to a JSON-Schema-capable Veyor schema: already
 * capable schemas pass through, known vendors (valibot, typebox) are upgraded
 * in place, anything else fails at definition time. Effect schemas are not
 * natively Standard Schema compatible — bring those through `schema()` from
 * `@veyorhq/core/schema/effect`.
 */
export function getJsonSchema<I, O>(schema: StandardSchemaV1<I, O>): VeyorSchema<I, O> {
  if (hasJsonSchema(schema)) return schema as VeyorSchema<I, O>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- upgrades preserve I/O
  if (isValibotSchema(schema)) return valibot(schema) as unknown as VeyorSchema<I, O>;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- upgrades preserve I/O
  if (isTypeboxSchema(schema)) return typebox(schema) as unknown as VeyorSchema<I, O>;

  throw new Error(
    "This schema does not support JSON Schema generation. " +
      "Use a natively capable schema (valibot, typebox) or a @veyorhq/core schema adapter."
  );
}
