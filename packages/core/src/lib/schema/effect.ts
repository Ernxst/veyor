import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ParseOptions } from "effect/SchemaAST";
import type { ForgeSchema } from "./index.ts";

export type EffectSchema = Schema.Codec<unknown, Record<string, unknown>, never, unknown>;

export const UnknownFromJsonString: Schema.fromJsonString<Schema.Unknown> = Schema.fromJsonString(
  Schema.Unknown
);

export const JsonStringify: (
  input: unknown,
  options?: ParseOptions
) => Effect.Effect<string, Schema.SchemaError, never> =
  Schema.encodeUnknownEffect(UnknownFromJsonString);

export const JsonParse: (
  input: unknown,
  options?: ParseOptions
) => Effect.Effect<unknown, Schema.SchemaError, never> =
  Schema.decodeUnknownEffect(UnknownFromJsonString);

export const isEffectSchema = (value: unknown): value is EffectSchema => Schema.isSchema(value);

export function schema<A>(value: Schema.ConstraintDecoder<A>): ForgeSchema<unknown, A> {
  return Object.assign(Schema.toStandardSchemaV1(value), Schema.toStandardJSONSchemaV1(value));
}
