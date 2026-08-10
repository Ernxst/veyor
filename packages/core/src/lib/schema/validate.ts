import type { StandardSchemaV1 } from "@standard-schema/spec";

// @effect-diagnostics-next-line asyncFunction:off
export async function validate<T>(
  schema: StandardSchemaV1<T>,
  value: unknown,
  context: string,
  subject: string
): Promise<T> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new Error(
      `The ${context} for "${subject}" does not match its schema: ${JSON.stringify(value)}`,
      {
        cause: result.issues,
      }
    );
  }

  return result.value;
}
