/**
 * Coarse shape reading over a machine's JSON Schema. The CLI only needs to
 * know how to lift an argv string at a given context path — the schema
 * itself stays the sole authority on whether the value is right.
 */

export type Kind = "string" | "number" | "integer" | "boolean" | "json" | "unknown";

type Node = Readonly<Record<string, unknown>>;

/** The coarse kind of the value at `path`, or "unknown" when unresolvable. */
export function kindAt(root: unknown, path: readonly string[]): Kind {
  let node = resolve(root, root);
  for (const segment of path) {
    const next = propertyOf(node, segment, root);
    if (next === undefined) return "unknown";
    node = resolve(next, root);
  }

  return kindOf(node, root);
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Follows `#/`-local `$ref` pointers to the node they name. */
function resolve(node: unknown, root: unknown, depth = 0): unknown {
  if (depth > 16 || !isNode(node)) return node;
  if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) return node;
  return resolve(dereference(node.$ref, root), root, depth + 1);
}

function dereference(ref: string, root: unknown): unknown {
  let target: unknown = root;
  for (const key of ref.slice(2).split("/")) {
    if (!isNode(target)) return undefined;
    target = target[key.replaceAll("~1", "/").replaceAll("~0", "~")];
  }

  return target;
}

/** The root's top-level property names, following `$ref` and branch combinators. */
export function propertyNames(root: unknown): readonly string[] {
  return collectPropertyNames(resolve(root, root), root);
}

function collectPropertyNames(node: unknown, root: unknown, depth = 0): readonly string[] {
  if (depth > 16 || !isNode(node)) return [];
  const own = isNode(node.properties) ? Object.keys(node.properties) : [];
  const branch = ["anyOf", "oneOf", "allOf"].flatMap((combinator) =>
    branchPropertyNames(node[combinator], root, depth)
  );

  return [...new Set([...own, ...branch])];
}

function branchPropertyNames(branches: unknown, root: unknown, depth: number): readonly string[] {
  if (!isUnknownArray(branches)) return [];
  return branches.flatMap((branch) => collectPropertyNames(resolve(branch, root), root, depth + 1));
}

function propertyOf(node: unknown, segment: string, root: unknown): unknown {
  if (!isNode(node)) return undefined;
  return ownProperty(node, segment) ?? branchProperty(node, segment, root);
}

function ownProperty(node: Node, segment: string): unknown {
  if (!isNode(node.properties)) return undefined;
  return segment in node.properties ? node.properties[segment] : undefined;
}

function branchProperty(node: Node, segment: string, root: unknown): unknown {
  for (const combinator of ["anyOf", "oneOf", "allOf"]) {
    const found = firstBranchProperty(node[combinator], segment, root);
    if (found !== undefined) return found;
  }

  return undefined;
}

function firstBranchProperty(branches: unknown, segment: string, root: unknown): unknown {
  if (!isUnknownArray(branches)) return undefined;
  for (const branch of branches) {
    const found = propertyOf(resolve(branch, root), segment, root);
    if (found !== undefined) return found;
  }

  return undefined;
}

function kindOf(node: unknown, root: unknown, depth = 0): Kind {
  if (depth > 16) return "unknown";
  if (!isNode(node)) return "unknown";
  return resolveKind(node, root, depth) ?? "unknown";
}

function resolveKind(node: Node, root: unknown, depth: number): Kind | undefined {
  return kindOfType(typeOf(node)) ?? kindOfLiterals(node) ?? kindOfBranches(node, root, depth);
}

/** The declared `type`, with `null` arms of a nullable union stripped. */
function typeOf(node: Node): unknown {
  if (!isUnknownArray(node.type)) return node.type;
  return sole(node.type.filter((entry) => entry !== "null"));
}

const KIND_BY_TYPE: Readonly<Record<string, Kind>> = {
  string: "string",
  integer: "integer",
  number: "number",
  boolean: "boolean",
  object: "json",
  array: "json",
};

function kindOfType(type: unknown): Kind | undefined {
  return typeof type === "string" ? KIND_BY_TYPE[type] : undefined;
}

function kindOfLiterals(node: Node): Kind | undefined {
  if ("const" in node) return kindOfValue(node.const);
  if (isUnknownArray(node.enum)) return sole(node.enum.map(kindOfValue));
  return undefined;
}

function kindOfBranches(node: Node, root: unknown, depth: number): Kind | undefined {
  for (const combinator of ["anyOf", "oneOf"]) {
    const branches = node[combinator];
    if (!isUnknownArray(branches)) continue;
    const kind = sole(branches.map((branch) => kindOf(resolve(branch, root), root, depth + 1)));
    if (kind !== undefined) return kind;
  }

  return undefined;
}

function kindOfValue(value: unknown): Kind {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return "json";
}

/** The single distinct element of `entries`, or undefined. */
function sole<T>(entries: readonly T[]): T | undefined {
  const [first, ...rest] = entries;
  return first !== undefined && rest.every((entry) => entry === first) ? first : undefined;
}
