import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { AstNode, Rule } from "./rule-helpers.mts";

const workspaceGroups = ["apps", "packages"];
const workspacePackageCache = new Map<string, Map<string, string>>();

/**
 * @param {string} filename File currently being linted.
 * @returns {string | undefined} Monorepo root containing the file.
 */
function findWorkspaceRoot(filename: string): string | undefined {
  let directory = dirname(filename);
  let parent = dirname(directory);

  while (directory !== parent) {
    const packageJson = readJson(join(directory, "package.json"));
    if (Array.isArray(packageJson.workspaces)) return directory;

    directory = parent;
    parent = dirname(directory);
  }

  return Array.isArray(readJson(join(directory, "package.json")).workspaces)
    ? directory
    : undefined;
}

/**
 * @param {unknown} value Value to inspect.
 * @returns {value is Record<string, unknown>} Whether the value is a JSON object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string} filename JSON file to read.
 * @returns {Record<string, unknown>} Parsed JSON object, or an empty object.
 */
function readJson(filename: string): Record<string, unknown> {
  if (!existsSync(filename)) return {};

  try {
    const value: unknown = JSON.parse(readFileSync(filename, "utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} root Workspace root.
 * @returns {Map<string, string>} Workspace package names and directories.
 */
function workspacePackages(root: string): Map<string, string> {
  const cached = workspacePackageCache.get(root);
  if (cached) return cached;

  const packages = new Map<string, string>();
  workspacePackageCache.set(root, packages);

  for (const group of workspaceGroups) {
    const groupDirectory = join(root, group);
    if (!existsSync(groupDirectory)) continue;

    for (const entry of readdirSync(groupDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const packageDirectory = join(groupDirectory, entry.name);
      const packageJson = readJson(join(packageDirectory, "package.json"));
      if (typeof packageJson.name === "string") {
        packages.set(packageJson.name, packageDirectory);
      }
    }
  }

  return packages;
}

/**
 * @param {string} root Workspace root.
 * @param {string} filename File path inside the workspace.
 * @returns {string | undefined} Workspace path such as `apps/web`.
 */
function workspacePath(root: string, filename: string): string | undefined {
  const path = relative(root, filename).split(sep).join("/");
  const match = /^(apps|packages)\/([^/]+)(?:\/|$)/.exec(path);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * @param {string} root Workspace root.
 * @param {string} workspace Workspace path such as apps/web.
 * @param {string} target Resolved import target.
 * @returns {boolean} Whether the target is outside the source workspace.
 */
function isOutsideWorkspace(root: string, workspace: string, target: string): boolean {
  const workspaceDirectory = resolve(root, workspace);
  const pathFromWorkspace = relative(workspaceDirectory, target);
  return (
    pathFromWorkspace === ".." ||
    pathFromWorkspace.startsWith(`..${sep}`) ||
    pathFromWorkspace.startsWith(sep)
  );
}

/**
 * @param {string} root Workspace root.
 * @param {string} specifier Import specifier.
 * @param {string} sourceFile Importing file.
 * @returns {string | undefined} Resolved local target path.
 */
function resolveLocalTarget(
  root: string,
  specifier: string,
  sourceFile: string
): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(sourceFile), specifier);
  if (specifier.startsWith("/")) return resolve(specifier);

  const packages = [...workspacePackages(root)].sort(
    ([left], [right]) => right.length - left.length
  );
  const workspacePackage = packages.find(
    ([name]) => specifier === name || specifier.startsWith(`${name}/`)
  );
  return workspacePackage?.[1];
}

/**
 * @param {string} root Workspace root.
 * @param {string} filename File path to inspect.
 * @returns {boolean} Whether the file is production code.
 */
function isProductionFile(root: string, filename: string): boolean {
  const path = relative(root, filename).split(sep).join("/");
  return (
    /^(apps|packages)\//.test(path) && !/(^|\/)(test|__tests__)(\/|$)|\.(test|spec)\./.test(path)
  );
}

/**
 * @param {AstNode | undefined} node Import source node.
 * @returns {string | undefined} Static import specifier.
 */
function stringValue(node: AstNode | undefined): string | undefined {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

const noInvalidWorkspaceImports: Rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      appToApp: "Applications must not import another application.",
      databaseToWeb: "The database package must not import the web application.",
      testSupportInProduction: "Production code must not import the test-support package.",
    },
  },
  /**
   * @param {RuleContext} context Rule execution context.
   * @returns {Record<string, (node: AstNode) => void>} AST visitors.
   */
  create: (context) => {
    const sourceFile = context.filename ?? "";
    if (sourceFile === "" || sourceFile.startsWith("<")) return {};

    const workspaceRoot = findWorkspaceRoot(sourceFile) ?? "";
    if (workspaceRoot === "") return {};

    const sourceWorkspaceName = workspacePath(workspaceRoot, sourceFile) ?? "";
    if (sourceWorkspaceName === "") return {};

    /**
     * @param {AstNode} node Node containing an import source.
     * @param {AstNode | undefined} sourceNode String-literal source node.
     * @returns {void}
     */
    function checkImport(node: AstNode, sourceNode: AstNode | undefined): void {
      const specifier = stringValue(sourceNode);
      if (!specifier) return;

      const target = resolveLocalTarget(workspaceRoot, specifier, sourceFile);
      if (!target) return;

      const targetWorkspace = workspacePath(workspaceRoot, target);
      if (!targetWorkspace) return;

      if (
        sourceWorkspaceName.startsWith("apps/") &&
        targetWorkspace.startsWith("apps/") &&
        sourceWorkspaceName !== targetWorkspace
      ) {
        context.report({ node: sourceNode ?? node, messageId: "appToApp" });
        return;
      }

      if (sourceWorkspaceName === "packages/db" && targetWorkspace === "apps/web") {
        context.report({ node: sourceNode ?? node, messageId: "databaseToWeb" });
        return;
      }

      if (
        targetWorkspace === "packages/test-support" &&
        isProductionFile(workspaceRoot, sourceFile)
      ) {
        context.report({ node: sourceNode ?? node, messageId: "testSupportInProduction" });
      }
    }

    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          checkImport(node, node.arguments[0]);
        }
      },
      ExportAllDeclaration(node) {
        checkImport(node, node.source);
      },
      ExportNamedDeclaration(node) {
        checkImport(node, node.source);
      },
      ImportDeclaration(node) {
        checkImport(node, node.source);
      },
      ImportExpression(node) {
        checkImport(node, node.source);
      },
    };
  },
};

const noCrossPackagePathImports: Rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      crossPackage:
        "Cross-package imports must use a package specifier instead of a filesystem path.",
    },
  },
  /**
   * @param {RuleContext} context Rule execution context.
   * @returns {Record<string, (node: AstNode) => void>} AST visitors.
   */
  create: (context) => {
    const sourceFile = context.filename ?? "";
    if (sourceFile === "" || sourceFile.startsWith("<")) return {};

    const workspaceRoot = findWorkspaceRoot(sourceFile) ?? "";
    if (workspaceRoot === "") return {};

    const sourceWorkspaceName = workspacePath(workspaceRoot, sourceFile) ?? "";
    if (sourceWorkspaceName === "") return {};

    /**
     * @param {AstNode} node Node containing an import source.
     * @param {AstNode | undefined} sourceNode String-literal source node.
     * @returns {void}
     */
    function checkImport(node: AstNode, sourceNode: AstNode | undefined): void {
      const specifier = stringValue(sourceNode);
      if (!specifier || (!specifier.startsWith(".") && !specifier.startsWith("/"))) return;

      const target = resolveLocalTarget(workspaceRoot, specifier, sourceFile);
      if (!target || !isOutsideWorkspace(workspaceRoot, sourceWorkspaceName, target)) return;

      context.report({ node: sourceNode ?? node, messageId: "crossPackage" });
    }

    return {
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          checkImport(node, node.arguments[0]);
        }
      },
      ExportAllDeclaration(node) {
        checkImport(node, node.source);
      },
      ExportNamedDeclaration(node) {
        checkImport(node, node.source);
      },
      ImportDeclaration(node) {
        checkImport(node, node.source);
      },
      ImportExpression(node) {
        checkImport(node, node.source);
      },
    };
  },
};

/** @type {{meta: {name: string}, rules: Record<string, Rule>}} */
const packageBoundaries = {
  meta: { name: "package-boundaries" },
  rules: {
    "no-cross-package-path-imports": noCrossPackagePathImports,
    "no-invalid-workspace-imports": noInvalidWorkspaceImports,
  },
};

export default packageBoundaries;
