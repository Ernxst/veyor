interface TemplateElement {
  value: { cooked: string | undefined };
}

export interface AstNode {
  type: string;
  parent?: AstNode;
  loc: { start: { line: number }; end: { line: number } };
  callee: AstNode;
  object: AstNode;
  property: AstNode;
  arguments: AstNode[];
  argument?: AstNode;
  body: AstNode & AstNode[];
  expression: AstNode;
  source: AstNode;
  specifiers?: AstNode[];
  imported?: AstNode;
  local?: AstNode;
  expressions: AstNode[];
  quasis: TemplateElement[];
  value: string | number | boolean | null | undefined;
  name?: string;
  operator?: string;
  computed: boolean;
  optional: boolean;
}

export interface SourceCode {
  getText(node?: AstNode): string;
}

interface RuleFix {
  text?: string;
}

interface RuleFixer {
  replaceText(node: AstNode | string, text: string): RuleFix;
}

interface ReportDescriptor {
  node: AstNode;
  messageId: string;
  data?: Record<string, string>;
  fix?: (fixer: RuleFixer) => RuleFix;
}

interface RuleOptions {
  allow?: string[];
}

export interface RuleContext {
  filename?: string;
  sourceCode: SourceCode;
  options: RuleOptions[];
  report(descriptor: ReportDescriptor): void;
}

type RuleListener = (node: AstNode) => void;
export type RuleListeners = Record<string, RuleListener>;

export interface Rule {
  meta: {
    name?: string;
    type?: string;
    fixable?: string;
    schema?: unknown[];
    messages?: Record<string, string>;
  };
  create(context: RuleContext): RuleListeners;
}

export interface Expectation {
  value: AstNode | undefined;
  matcher: string | undefined;
}

/** @type {Set<string>} */
export const testNames = new Set(["it", "test"]);

/**
 * @param {AstNode | undefined} node Member-expression node to inspect.
 * @returns {string | undefined} Static property name, when available.
 */
export function propertyName(node: AstNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  if (node.computed && node.property.type === "Literal") {
    return typeof node.property.value === "string" ? node.property.value : undefined;
  }
  if (
    node.computed &&
    node.property.type === "TemplateLiteral" &&
    node.property.expressions.length === 0
  ) {
    return node.property.quasis[0]?.value.cooked;
  }
  return node.computed ? undefined : node.property.name;
}

/**
 * @param {AstNode | undefined} node Call node to inspect.
 * @param {string} name Vitest method name.
 * @returns {boolean} Whether the node is a matching vi call.
 */
export function isViCall(node: AstNode | undefined, name: string): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "vi" &&
    propertyName(node.callee) === name
  );
}

/**
 * @param {AstNode | undefined} node Import or literal node to inspect.
 * @returns {string | undefined} Module specifier, when static.
 */
export function moduleSource(node: AstNode | undefined): string | undefined {
  if (node?.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node?.type === "ImportExpression" && node.source.type === "Literal") {
    return typeof node.source.value === "string" ? node.source.value : undefined;
  }
  return undefined;
}

/**
 * @param {AstNode | undefined} node Call node to inspect.
 * @returns {string | undefined} Called function name, when static.
 */
export function callName(node: AstNode | undefined): string | undefined {
  if (node?.type !== "CallExpression") return undefined;
  return node.callee.type === "Identifier" ? node.callee.name : propertyName(node.callee);
}

/**
 * @param {AstNode} node AST node whose ancestors should be searched.
 * @returns {AstNode | undefined} Nearest enclosing function.
 */
export function nearestFunction(node: AstNode): AstNode | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      return current;
    }
  }
  return undefined;
}

/**
 * @param {AstNode | undefined} fn Callback function to inspect.
 * @returns {AstNode | undefined} Containing call, when the function is an argument.
 */
export function containingCall(fn: AstNode | undefined): AstNode | undefined {
  if (!fn) return undefined;
  const parent = fn.parent;
  return parent?.type === "CallExpression" && parent.arguments.includes(fn) ? parent : undefined;
}

/**
 * @param {AstNode} node AST node to inspect.
 * @returns {boolean} Whether the node is inside a test callback.
 */
export function isInsideTest(node: AstNode): boolean {
  for (let fn = nearestFunction(node); fn; fn = nearestFunction(fn)) {
    const name = callName(containingCall(fn));
    if (name && testNames.has(name)) return true;
  }
  return false;
}

/**
 * @param {AstNode} node Call node to inspect.
 * @returns {Expectation | undefined} Expectation matcher details, when present.
 */
export function expectation(node: AstNode): Expectation | undefined {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return undefined;
  const expectCall = node.callee.object;
  if (expectCall.type !== "CallExpression" || callName(expectCall) !== "expect") return undefined;
  return { value: expectCall.arguments[0], matcher: propertyName(node.callee) };
}

/**
 * @param {Record<string, string>} messages Rule message definitions.
 * @param {(context: RuleContext) => RuleListeners} create Visitor factory.
 * @param {unknown[]} [schema] Rule option schema.
 * @returns {Rule} Rule metadata and visitor factory.
 */
export function rule(
  messages: Record<string, string>,
  create: (context: RuleContext) => RuleListeners,
  schema: unknown[] = []
): Rule {
  return {
    meta: { type: "problem", schema, messages },
    create,
  };
}
