import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type * as v from "valibot";

export function isValibotSchema(schema: unknown): schema is v.AnySchema {
  if (schema === null || typeof schema !== "object") return false;
  return "vendor" in schema && schema.vendor === "valibot";
}

export function valibot<S extends v.AnySchema>(schema: S): StandardJSONSchemaV1 {
  return Object.assign(schema, toStandardJsonSchema(schema));
}
