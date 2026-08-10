import type { StandardSchemaV1, StandardJSONSchemaV1 } from "@standard-schema/spec";
import { isTypeboxSchema, typebox } from "./typebox.ts";
import { isValibotSchema, valibot } from "./valibot.ts";

export type ForgeSchema<I = unknown, O = I> = StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O>;

function hasJsonSchema(schema: StandardSchemaV1): schema is ForgeSchema {
  return "jsonSchema" in schema["~standard"];
}

export function getJsonSchema(schema: StandardSchemaV1): StandardJSONSchemaV1 {
  if (hasJsonSchema(schema)) return schema;
  if (isValibotSchema(schema)) return valibot(schema);
  if (isTypeboxSchema(schema)) return typebox(schema);

  throw new Error(
    "This schema does not support JSON Schema generation. Use a schema with JSON Schema support."
  );
}
