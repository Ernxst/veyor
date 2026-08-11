/**
 * Publish-time rewrite, never committed: npm does not understand the
 * workspace: protocol, so every workspace dependency in a publishable
 * manifest becomes a caret range on the target's actual version.
 *
 *   bun .github/scripts/prepare-publish.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

type DependencyField = "dependencies" | "devDependencies" | "peerDependencies";

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly [field: string]: unknown;
}

const manifests = readdirSync("packages")
  .map((name) => `packages/${name}/package.json`)
  .filter((path) => existsSync(path))
  .map((path) => ({ path, pkg: parseManifest(readFileSync(path, "utf8"), path) }));

const versionOf = new Map(manifests.map(({ pkg }) => [pkg.name, pkg.version]));

for (const { path, pkg } of manifests) {
  if (pkg.private === true) continue;

  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    rewrite(pkg, field);
  }

  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`prepared ${pkg.name}@${pkg.version}`);
}

function rewrite(pkg: PackageJson, field: DependencyField): void {
  const deps = pkg[field];
  if (!isRecord(deps)) return;

  for (const [name, range] of Object.entries(deps)) {
    if (isWorkspaceRange(range)) deps[name] = `^${targetVersion(pkg, name)}`;
  }
}

function isWorkspaceRange(range: unknown): range is string {
  return typeof range === "string" && range.startsWith("workspace:");
}

function targetVersion(pkg: PackageJson, name: string): string {
  const version = versionOf.get(name);
  if (version === undefined) {
    throw new Error(`${pkg.name} depends on unknown workspace package ${name}`);
  }

  return version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseManifest(contents: string, path: string): PackageJson {
  const parsed: unknown = JSON.parse(contents);
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error(`${path} is not a package manifest`);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structurally checked above
  return parsed as PackageJson;
}
