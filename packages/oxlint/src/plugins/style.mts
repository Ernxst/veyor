import type { AstNode, Rule, RuleContext, SourceCode } from "./rule-helpers.mts";

const testDefinitions = new Set(["describe", "it", "suite", "test"]);

/**
 * @param {AstNode | undefined} node Call node to inspect.
 * @returns {string | undefined} Root called function name, when static.
 */
function rootCallName(node: AstNode | undefined): string | undefined {
  if (node?.type !== "CallExpression") return undefined;
  if (node.callee.type === "Identifier") return node.callee.name;
  if (node.callee.type === "CallExpression") return rootCallName(node.callee);
  if (node.callee.type === "MemberExpression") {
    const object = /** @type {AstNode} */ (node.callee.object);
    return object.type === "Identifier" ? object.name : rootCallName(object);
  }
  return undefined;
}

/**
 * @param {AstNode | undefined} fn Callback function to inspect.
 * @returns {AstNode | undefined} Containing call, when the function is an argument.
 */
function containingCall(fn: AstNode | undefined): AstNode | undefined {
  if (!fn) return undefined;
  const parent = fn.parent;
  return parent?.type === "CallExpression" && parent.arguments.includes(fn) ? parent : undefined;
}

/**
 * @param {AstNode | undefined} node Call or member node to inspect.
 * @param {string} modifier Test modifier name.
 * @returns {boolean} Whether the modifier occurs in the call chain.
 */
function hasTestModifier(node: AstNode | undefined, modifier: string): boolean {
  if (node?.type === "CallExpression") return hasTestModifier(node.callee, modifier);
  if (node?.type !== "MemberExpression") return false;
  return (
    (!node.computed && node.property.type === "Identifier" && node.property.name === modifier) ||
    hasTestModifier(node.object, modifier)
  );
}

/**
 * @param {AstNode} fn Test callback function.
 * @returns {boolean} Whether the test uses an effect or live modifier.
 */
function isEffectTest(fn: AstNode): boolean {
  const call = containingCall(fn);
  return hasTestModifier(call, "effect") || hasTestModifier(call, "live");
}

/**
 * @param {AstNode | undefined} node Expression node to inspect.
 * @returns {boolean} Whether the expression is a vi call.
 */
function isViCall(node: AstNode | undefined): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "vi"
  );
}

/**
 * @param {SourceCode} sourceCode Source-code helper.
 * @param {AstNode} expression Expression whose value is discarded.
 * @returns {string} Fix text that explicitly discards the expression.
 */
function discardedExpression(sourceCode: SourceCode, expression: AstNode): string {
  const text = sourceCode.getText(expression);
  if (expression.operator === "void") return text;
  return expression.type === "SequenceExpression" ? `void (${text})` : `void ${text}`;
}

/**
 * @param {RuleContext} context Rule execution context.
 * @param {AstNode} node Arrow function node.
 * @returns {void} Reports a callback that needs a block body.
 */
function requireBlock(context: RuleContext, node: AstNode): void {
  context.report({
    node: node.body,
    messageId: "test",
    fix: (fixer) =>
      fixer.replaceText(node.body, `{ return ${context.sourceCode.getText(node.body)}; }`),
  });
}

/**
 * @param {AstNode} body Function body node.
 * @returns {AstNode | undefined} Sole return statement, when present.
 */
function onlyReturnStatement(body: AstNode): AstNode | undefined {
  if (body.type !== "BlockStatement" || body.body.length !== 1) return undefined;
  const [statement] = body.body;
  return statement?.type === "ReturnStatement" && statement.argument ? statement : undefined;
}

/**
 * @param {SourceCode} sourceCode Source-code helper.
 * @param {AstNode} expression Expression to use as an arrow body.
 * @returns {string} Expression text with object or sequence grouping.
 */
function arrowExpression(sourceCode: SourceCode, expression: AstNode): string {
  const text = sourceCode.getText(expression);
  return expression.type === "ObjectExpression" || expression.type === "SequenceExpression"
    ? `(${text})`
    : text;
}

/**
 * @param {RuleContext} context Rule execution context.
 * @param {AstNode} node Arrow function node.
 * @param {AstNode} statement Return statement to simplify.
 * @returns {void} Reports and fixes a concise return.
 */
function requireConciseReturn(context: RuleContext, node: AstNode, statement: AstNode): void {
  const argument = statement.argument;
  if (!argument) return;
  context.report({
    node: node.body,
    messageId: "concise",
    fix: (fixer) => fixer.replaceText(node.body, arrowExpression(context.sourceCode, argument)),
  });
}

/**
 * @param {AstNode} body Function body node.
 * @returns {boolean} Whether the body assigns to a value.
 */
function isAssignmentBody(body: AstNode): boolean {
  return (
    body.type === "AssignmentExpression" ||
    (body.type === "UnaryExpression" && body.argument?.type === "AssignmentExpression")
  );
}

const preferConciseArrow: Rule = {
  meta: {
    type: "suggestion",
    fixable: "code",
    schema: [],
    messages: {
      assignment: "Keep assignment arrow functions in a block body",
      concise: "Write a one-line expression arrow function without braces",
      test: "Keep test-definition callbacks in a block body",
    },
  },
  create: (context) => ({
    ArrowFunctionExpression(node) {
      const owner = rootCallName(containingCall(node));
      if (isAssignmentBody(node.body)) {
        context.report({ node: node.body, messageId: "assignment" });
        return;
      }
      if (
        owner === "onTestFinished" &&
        node.body.type !== "BlockStatement" &&
        isViCall(node.body)
      ) {
        context.report({
          node: node.body,
          messageId: "concise",
          fix: (fixer) =>
            fixer.replaceText(node.body, discardedExpression(context.sourceCode, node.body)),
        });
        return;
      }
      if (owner && testDefinitions.has(owner)) {
        const returnStatement = onlyReturnStatement(node.body);
        if (isEffectTest(node)) {
          if (returnStatement) requireConciseReturn(context, node, returnStatement);
        } else if (node.body.type !== "BlockStatement") {
          requireBlock(context, node);
        }
        return;
      }
      if (node.body.type !== "BlockStatement" || node.body.body.length !== 1) return;
      const [statement] = node.body.body;
      if (!statement) return;
      if (statement.type !== "ExpressionStatement") return;
      if (statement.expression.type === "AssignmentExpression") return;
      if (statement.loc.start.line !== statement.loc.end.line) return;

      context.report({
        node: node.body,
        messageId: "concise",
        fix: (fixer) =>
          fixer.replaceText(
            node.body,
            discardedExpression(context.sourceCode, statement.expression)
          ),
      });
    },
  }),
};

/** @type {{meta: {name: string}, rules: Record<string, Rule>}} */
const style = {
  meta: { name: "style" },
  rules: { "prefer-concise-arrow": preferConciseArrow },
};

export default style;
