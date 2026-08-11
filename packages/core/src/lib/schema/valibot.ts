import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type * as v from "valibot";

export function isValibotSchema(schema: unknown): schema is v.AnySchema {
  if (!isRecord(schema) || !("~standard" in schema)) return false;
  const standard = schema["~standard"];
  return isRecord(standard) && "vendor" in standard && standard.vendor === "valibot";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function valibot<S extends v.AnySchema>(schema: S): StandardJSONSchemaV1 {
  return toStandardJsonSchema(schema);
}
