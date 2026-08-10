import { type TSchema, type Static, Kind } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";

export function isTypeboxSchema(value: unknown): value is TSchema {
  return typeof value === "object" && value !== null && Kind in value;
}

export function typebox<S extends TSchema>(
  schema: S
): StandardSchemaV1<unknown, Static<S>> & StandardJSONSchemaV1<unknown, Static<S>> {
  return {
    "~standard": {
      version: 1,
      vendor: "typebox",

      validate(value) {
        if (Value.Check(schema, value)) {
          return { value: value as Static<S> };
        }

        return {
          issues: [...Value.Errors(schema, value)].map((error) => ({
            message: error.message,
            path: error.path
              .split("/")
              .filter(Boolean)
              .map((key) => ({ key })),
          })),
        };
      },

      jsonSchema: {
        input: () => schema,
        output: () => schema,
      },
    },
  };
}
