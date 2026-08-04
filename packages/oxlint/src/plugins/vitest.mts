import {
  callName,
  containingCall,
  expectation,
  isInsideTest,
  isViCall,
  moduleSource,
  nearestFunction,
  propertyName,
  rule,
  testNames,
} from "./rule-helpers.mts";
import type { AstNode } from "./rule-helpers.mts";

const noTestTimers = rule(
  {
    tick: "Do not use Promise.resolve() as a next-tick primitive",
    timer: "Use fake timers instead of {{name}} in tests",
  },
  (context) => ({
    CallExpression(node) {
      const name = callName(node);
      if (name === "setInterval" || name === "setTimeout") {
        context.report({ node, messageId: "timer", data: { name } });
      }
      if (
        node.parent?.type === "AwaitExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "Promise" &&
        propertyName(node.callee) === "resolve" &&
        node.arguments.length === 0
      ) {
        context.report({ node, messageId: "tick" });
      }
    },
  })
);

const noTestYield = rule(
  { yield: "Wait for an observable condition instead of yielding with {{name}}" },
  (context) => ({
    CallExpression(node) {
      const name = callName(node);
      if (
        name === "queueMicrotask" ||
        name === "requestAnimationFrame" ||
        name === "requestIdleCallback" ||
        name === "setImmediate"
      ) {
        context.report({ node, messageId: "yield", data: { name } });
      }
    },
  })
);

const noBooleanExpect = rule(
  { direct: "Assert the values that produced this boolean expression" },
  (context) => ({
    CallExpression(node) {
      if (callName(node) !== "expect") return;
      const value = node.arguments[0];
      if (
        value?.type === "BinaryExpression" ||
        value?.type === "LogicalExpression" ||
        (value?.type === "UnaryExpression" && value.operator === "!")
      ) {
        context.report({ node: value, messageId: "direct" });
      }
    },
  })
);

const noFinally = rule({ cleanup: "Use onTestFinished for per-test cleanup" }, (context) => ({
  CallExpression(node) {
    if (propertyName(node.callee) === "finally") context.report({ node, messageId: "cleanup" });
  },
}));

const noControlFlow = rule(
  { branch: "Use separate or parameterised test cases instead of {{kind}}" },
  (context) => {
    /**
     * @param {AstNode} node Branch node to inspect.
     * @param {string} kind Branch kind for the diagnostic.
     * @returns {void} Reports control flow inside a test.
     */
    const check = (node: AstNode, kind: string): void => {
      if (isInsideTest(node)) context.report({ node, messageId: "branch", data: { kind } });
    };
    /**
     * @param {AstNode} node Loop node to inspect.
     * @returns {void} Reports loops over assertions inside a test.
     */
    const checkExpectationLoop = (node: AstNode): void => {
      if (isInsideTest(node) && context.sourceCode.getText(node).includes("expect(")) {
        context.report({ node, messageId: "branch", data: { kind: "a loop over assertions" } });
      }
    };
    return {
      IfStatement: (node) => check(node, "if"),
      TryStatement: (node) => check(node, "try/catch"),
      ForStatement: checkExpectationLoop,
      ForInStatement: checkExpectationLoop,
      ForOfStatement: checkExpectationLoop,
      CallExpression(node) {
        if (propertyName(node.callee) === "forEach") checkExpectationLoop(node);
      },
    };
  }
);

const noAssertionInCallback = rule(
  { assertion: "Run the callback, then assert on the spy after it returns" },
  (context) => ({
    CallExpression(node) {
      if (callName(node) !== "expect") return;
      for (let fn = nearestFunction(node); fn; fn = nearestFunction(fn)) {
        const owner = callName(containingCall(fn));
        if (owner === "act" || owner === "fn" || owner === "mockImplementation") {
          context.report({ node, messageId: "assertion" });
          return;
        }
      }
    },
  })
);

const noMockCalls = rule(
  { history: "Use call matchers instead of reading mock.calls" },
  (context) => ({
    MemberExpression(node) {
      if (propertyName(node) !== "calls") return;
      if (propertyName(node.object) === "mock") context.report({ node, messageId: "history" });
    },
  })
);

const noInexactCardinality = rule(
  { count: "Assert exact cardinality only when it is required behaviour" },
  (context) => ({
    CallExpression(node) {
      const current = expectation(node);
      const valueName = propertyName(current?.value);
      if (!current || !valueName || !["length", "size"].includes(valueName)) return;
      if (current.matcher?.startsWith("toBeGreaterThan")) {
        context.report({ node, messageId: "count" });
      }
    },
  })
);

const noPromiseConstructor = rule(
  { deferred: "Use Promise.withResolvers() instead of new Promise() in tests" },
  (context) => ({
    NewExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "Promise") {
        context.report({ node, messageId: "deferred" });
      }
    },
  })
);

const noInternalModuleMock = rule(
  { internal: "Mock the external SDK or network boundary, not repository module '{{source}}'" },
  (context) => {
    const allow = new Set(context.options[0]?.allow ?? []);
    return {
      CallExpression(node) {
        if (!isViCall(node, "mock")) return;
        const source = moduleSource(node.arguments[0]);
        if (typeof source !== "string" || allow.has(source)) return;
        if (source.startsWith("@/") || source.startsWith("./") || source.startsWith("../")) {
          context.report({ node, messageId: "internal", data: { source } });
        }
      },
    };
  },
  [
    {
      type: "object",
      properties: { allow: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    },
  ]
);

const noAmbiguousCalledWith = rule(
  { count: "Assert the call count and identify the expected call" },
  (context) => ({
    CallExpression(node) {
      const current = expectation(node);
      if (current?.matcher === "toHaveBeenCalledWith") {
        context.report({ node, messageId: "count" });
      }
    },
  })
);

const noCallbackCapture = rule(
  { capture: "Assert callback arguments with mock call matchers instead of capturing them" },
  (context) => ({
    AssignmentExpression(node) {
      for (let fn = nearestFunction(node); fn; fn = nearestFunction(fn)) {
        const owner = callName(containingCall(fn));
        if (
          owner === "fn" ||
          owner === "mockImplementation" ||
          owner === "mockImplementationOnce"
        ) {
          context.report({ node, messageId: "capture" });
          return;
        }
      }
    },
  })
);

/**
 * @param {AstNode | undefined} fn Mock implementation callback.
 * @returns {string | undefined} Shortcut replacement, when applicable.
 */
function shortcutKind(fn: AstNode | undefined): string | undefined {
  const body = fn?.body;
  if (
    body?.type === "BlockStatement" &&
    body.body.length === 1 &&
    body.body[0]?.type === "ThrowStatement"
  ) {
    return "mockThrow";
  }
  const value = body?.type === "BlockStatement" ? body.body[0]?.argument : body;
  if (
    value?.type === "NewExpression" &&
    value.callee.type === "Identifier" &&
    value.callee.name === "Promise"
  ) {
    return "mockReturnValue";
  }
  if (
    value?.type === "CallExpression" &&
    value.callee.type === "MemberExpression" &&
    value.callee.object.type === "Identifier" &&
    value.callee.object.name === "Promise"
  ) {
    return "mockReturnValue";
  }
  return undefined;
}

const noMockImplementationShortcut = rule(
  { shorthand: "Use {{replacement}} instead of mockImplementation for this value" },
  (context) => ({
    CallExpression(node) {
      if (propertyName(node.callee) !== "mockImplementation") return;
      const replacement = shortcutKind(node.arguments[0]);
      if (replacement) context.report({ node, messageId: "shorthand", data: { replacement } });
    },
  })
);

const noGlobalMockCleanup = rule(
  { hook: "Call vi.{{name}} only inside afterEach or onTestFinished" },
  (context) => ({
    CallExpression(node) {
      const name = propertyName(node.callee);
      if (name !== "resetModules" && name !== "restoreAllMocks") return;
      if (!isViCall(node, name)) return;
      const owner = callName(containingCall(nearestFunction(node)));
      if (owner !== "afterEach" && owner !== "onTestFinished") {
        context.report({ node, messageId: "hook", data: { name } });
      }
    },
  })
);

const mswRegistrationBoundaries = new Set(["beforeAll", "beforeEach", ...testNames]);

/**
 * @param {AstNode | undefined} fn Callback function to inspect.
 * @returns {string | undefined} Registration owner name, when static.
 */
function callbackOwner(fn: AstNode | undefined): string | undefined {
  const call = containingCall(fn);
  if (call?.callee.type !== "CallExpression") return callName(call);
  const factory = call.callee.callee;
  if (factory.type === "MemberExpression" && factory.object.type === "Identifier") {
    return factory.object.name;
  }
  return undefined;
}

/**
 * @param {AstNode} node MSW call node to inspect.
 * @returns {boolean} Whether the node is inside a registration boundary.
 */
function isInsideMswRegistrationBoundary(node: AstNode): boolean {
  for (let fn = nearestFunction(node); fn; fn = nearestFunction(fn)) {
    const owner = callbackOwner(fn);
    if (owner && mswRegistrationBoundaries.has(owner)) return true;
  }
  return false;
}

const noIndirectMswOverrides = rule(
  { indirect: "Register MSW overrides directly in a test or setup boundary" },
  (context) => ({
    CallExpression(node) {
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "server" &&
        propertyName(node.callee) === "use" &&
        nearestFunction(node) &&
        !isInsideMswRegistrationBoundary(node)
      ) {
        context.report({ node, messageId: "indirect" });
      }
    },
  })
);

const httpMethods = new Set(["all", "delete", "get", "head", "options", "patch", "post", "put"]);

const noInlineMswUrl = rule(
  { inline: "Use a canonical endpoint or named URL builder for MSW handler targets" },
  (context) => ({
    CallExpression(node) {
      const method = propertyName(node.callee);
      if (
        node.callee.type !== "MemberExpression" ||
        node.callee.object.type !== "Identifier" ||
        node.callee.object.name !== "http" ||
        !method ||
        !httpMethods.has(method)
      ) {
        return;
      }
      const target = node.arguments[0];
      const value =
        target?.type === "Literal"
          ? target.value
          : target?.type === "TemplateLiteral"
            ? target.quasis[0]?.value.cooked
            : undefined;
      if (target && typeof value === "string" && /^https?:\/\//iu.test(value)) {
        context.report({ node: target, messageId: "inline" });
      }
    },
  })
);

/** @type {{meta: {name: string}, rules: Record<string, Rule>}} */
const vitest = {
  meta: { name: "vitest" },
  rules: {
    "no-ambiguous-called-with": noAmbiguousCalledWith,
    "no-assertion-in-callback": noAssertionInCallback,
    "no-boolean-expect": noBooleanExpect,
    "no-callback-capture": noCallbackCapture,
    "no-control-flow": noControlFlow,
    "no-finally": noFinally,
    "no-global-mock-cleanup": noGlobalMockCleanup,
    "no-indirect-msw-overrides": noIndirectMswOverrides,
    "no-inexact-cardinality": noInexactCardinality,
    "no-inline-msw-url": noInlineMswUrl,
    "no-internal-module-mock": noInternalModuleMock,
    "no-mock-calls": noMockCalls,
    "no-mock-implementation-shortcut": noMockImplementationShortcut,
    "no-promise-constructor": noPromiseConstructor,
    "no-test-timers": noTestTimers,
    "no-test-yield": noTestYield,
  },
};

export default vitest;
