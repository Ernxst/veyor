import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Option } from "effect";
import * as Schema from "effect/Schema";
import { Argument, Flag } from "effect/unstable/cli";
import type { ArgSpec, ForgeConfig } from "./config.ts";
import { kindAt, type Kind } from "./jsonschema.ts";

/** A mistake on the command line, rendered without a stack trace. */
export class UsageError extends Schema.TaggedErrorClass<UsageError>("UsageError")("UsageError", {
  message: Schema.String,
}) {}

export interface BuiltArg {
  readonly spec: ArgSpec;
  /** Flag name and record key. */
  readonly id: string;
  /** How the arg reads in messages: `--budget` or `<task>`. */
  readonly display: string;
  readonly segments: readonly string[];
  readonly param: Flag.Flag<Option.Option<unknown>> | Argument.Argument<Option.Option<unknown>>;
  /** Turns the parsed command-line value into the value placed at `key`. */
  readonly lift: (raw: unknown) => unknown;
}

/** Flags every `run`/`simulate` command defines itself. */
const RESERVED = new Set(["assembly", "context", "seed", "json", "runs"]);

/**
 * Compiles the config's arg specs against the machine's JSON Schema:
 * each spec becomes a CLI param whose primitive type is read from the
 * schema at its context path. Positionals come first, in position order.
 */
export function buildArgs(config: ForgeConfig, jsonSchema: unknown): BuiltArg[] {
  const specs = [...(config.args ?? [])].sort(byPosition);
  const built = specs.map((spec) => buildArg(spec, jsonSchema));
  assertDistinctNames(built);
  return built;
}

function assertDistinctNames(built: readonly BuiltArg[]): void {
  const seen = new Set<string>();
  for (const arg of built) {
    if (RESERVED.has(arg.id)) {
      throw new Error(`forge.config: arg name "${arg.id}" is reserved; rename it with \`name\`.`);
    }
    if (seen.has(arg.id)) {
      throw new Error(`forge.config: duplicate arg name "${arg.id}".`);
    }
    seen.add(arg.id);
  }
}

function byPosition(a: ArgSpec, b: ArgSpec): number {
  return (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
}

function buildArg(spec: ArgSpec, jsonSchema: unknown): BuiltArg {
  const segments = spec.key.split(".");
  const id = idOf(spec, segments);
  const kind: Kind = spec.from === "file" ? "json" : kindAt(jsonSchema, segments);
  const positional = spec.position !== undefined;

  const presentation = positional
    ? { display: `<${id}>`, param: argumentFor(spec, id, kind) }
    : { display: `--${id}`, param: flagFor(spec, id, kind) };

  return { spec, id, segments, lift: liftFor(spec, id, kind), ...presentation };
}

function idOf(spec: ArgSpec, segments: readonly string[]): string {
  return spec.name ?? segments.at(-1) ?? spec.key;
}

function flagFor(spec: ArgSpec, id: string, kind: Kind): Flag.Flag<Option.Option<unknown>> {
  const flag = describe(spec, rawFlag(spec, id, kind), Flag.withDescription);
  return Flag.optional(flag);
}

const FLAG_BY_KIND: Readonly<Record<Kind, (id: string) => Flag.Flag<unknown>>> = {
  string: Flag.string,
  integer: Flag.integer,
  number: Flag.float,
  boolean: Flag.boolean,
  json: Flag.string,
  unknown: Flag.string,
};

function rawFlag(spec: ArgSpec, id: string, kind: Kind): Flag.Flag<unknown> {
  if (spec.from === "file") return Flag.fileParse(id);
  return FLAG_BY_KIND[kind](id);
}

function argumentFor(
  spec: ArgSpec,
  id: string,
  kind: Kind
): Argument.Argument<Option.Option<unknown>> {
  const argument = describe(spec, rawArgument(spec, id, kind), Argument.withDescription);
  return Argument.optional(argument);
}

const ARGUMENT_BY_KIND: Readonly<Record<Kind, (id: string) => Argument.Argument<unknown>>> = {
  string: Argument.string,
  integer: Argument.integer,
  number: Argument.float,
  // Positional booleans parse from their string literal in the lift.
  boolean: Argument.string,
  json: Argument.string,
  unknown: Argument.string,
};

function rawArgument(spec: ArgSpec, id: string, kind: Kind): Argument.Argument<unknown> {
  if (spec.from === "file") return Argument.fileParse(id);
  return ARGUMENT_BY_KIND[kind](id);
}

function describe<P>(spec: ArgSpec, param: P, withDescription: (param: P, text: string) => P): P {
  return spec.description === undefined ? param : withDescription(param, spec.description);
}

const identity = (raw: unknown): unknown => raw;

const LIFT_BY_KIND: Readonly<Record<Kind, (id: string) => (raw: unknown) => unknown>> = {
  string: () => identity,
  integer: () => identity,
  number: () => identity,
  boolean: liftBooleanLiteral,
  json: liftInlineJson,
  unknown: () => jsonOrString,
};

function liftFor(spec: ArgSpec, id: string, kind: Kind): (raw: unknown) => unknown {
  if (spec.from === "file") return identity;
  return LIFT_BY_KIND[kind](id);
}

/** Positional booleans arrive as strings; flag booleans are parsed natively. */
function liftBooleanLiteral(id: string): (raw: unknown) => unknown {
  return (raw) => {
    if (typeof raw !== "string") return raw;
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new UsageError({ message: `<${id}>: expected true or false.` });
  };
}

/** The schema wants a structure; the value arrives as an inline JSON string. */
function liftInlineJson(id: string): (raw: unknown) => unknown {
  return (raw) => {
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch {
      throw new UsageError({
        message: `--${id}: expected JSON (or use \`from: "file"\` in forge.config).`,
      });
    }
  };
}

/** The typeless lift for paths the schema can't describe: JSON if it parses, else the string. */
function jsonOrString(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Assembles the partial context: parsed arg values placed at their paths,
 * deep-merged over the `--context` base. Objects merge; everything else —
 * arrays included — replaces.
 */
export function contextFrom(
  args: readonly BuiltArg[],
  values: Readonly<Record<string, Option.Option<unknown>>>,
  base: unknown
): Record<string, unknown> | UsageError {
  try {
    return assembleContext(args, values, base);
  } catch (error) {
    if (Schema.is(UsageError)(error)) return error;
    throw error;
  }
}

function assembleContext(
  args: readonly BuiltArg[],
  values: Readonly<Record<string, Option.Option<unknown>>>,
  base: unknown
): Record<string, unknown> {
  return args.reduce((context, arg) => {
    const value = values[arg.id];
    if (value === undefined || Option.isNone(value)) return context;
    return withValueAt(context, arg.segments, arg.lift(value.value));
  }, baseContext(base));
}

function baseContext(base: unknown): Record<string, unknown> {
  if (base === undefined) return {};
  if (isRecord(base)) return { ...base };
  throw new UsageError({ message: "--context: expected the file to hold an object." });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withValueAt(
  target: Readonly<Record<string, unknown>>,
  segments: readonly string[],
  value: unknown
): Record<string, unknown> {
  const [head, ...rest] = segments;
  if (head === undefined) return { ...target };
  if (rest.length === 0) return { ...target, [head]: value };

  const existing = target[head];
  return { ...target, [head]: withValueAt(isRecord(existing) ? existing : {}, rest, value) };
}

/**
 * Maps schema issues back to the command line: an issue at a path some arg
 * owns is reported under that arg's flag, not its context path.
 */
export function describeIssues(
  issues: readonly StandardSchemaV1.Issue[],
  args: readonly BuiltArg[]
): string[] {
  return issues.map((issue) => `${subjectOf(issue, args)}: ${issue.message}`);
}

/** The arg (or bare context path) an issue is reported under. */
function subjectOf(issue: StandardSchemaV1.Issue, args: readonly BuiltArg[]): string {
  const path = pathOf(issue);
  const owner = owningArg(args, path) ?? soleArgUnder(args, path);
  if (owner !== undefined) return owner.display;
  return path.length > 0 ? path.join(".") : "context";
}

function pathOf(issue: StandardSchemaV1.Issue): string[] {
  return (issue.path ?? []).map((entry) =>
    typeof entry === "object" && "key" in entry ? String(entry.key) : String(entry)
  );
}

/** The longest declared arg the issue path falls under. */
function owningArg(args: readonly BuiltArg[], path: readonly string[]): BuiltArg | undefined {
  const owners = args.filter((arg) => isPrefix(arg.segments, path));
  return owners.sort((a, b) => b.segments.length - a.segments.length).at(0);
}

/** An issue above a declared arg is that arg's fault — if it is the only arg down there. */
function soleArgUnder(args: readonly BuiltArg[], path: readonly string[]): BuiltArg | undefined {
  const under = args.filter((arg) => isPrefix(path, arg.segments));
  return under.length === 1 ? under[0] : undefined;
}

function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, i) => segment === path[i]);
}
