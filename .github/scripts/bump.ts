/**
 * Lockstep release versioning: every publishable package carries the same
 * version. Takes `patch` | `minor` | `major` or an exact `x.y.z`, rewrites
 * each package.json, and prints the new version.
 *
 *   bun .github/scripts/bump.ts patch
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const input = process.argv.at(2);
if (input === undefined) {
  throw new Error("usage: bun .github/scripts/bump.ts <patch|minor|major|x.y.z>");
}

interface PackageJson {
  readonly name: string;
  version: string;
  readonly private?: boolean;
}

const manifests = readdirSync("packages")
  .map((name) => `packages/${name}/package.json`)
  .filter((path) => existsSync(path))
  .map((path) => ({ path, pkg: parseManifest(readFileSync(path, "utf8"), path) }))
  .filter(({ pkg }) => pkg.private !== true);

const current = manifests.at(0)?.pkg.version;
if (current === undefined) throw new Error("no publishable packages found");

const next = bump(current, input);

for (const { path, pkg } of manifests) {
  pkg.version = next;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(next);

function parseManifest(contents: string, path: string): PackageJson {
  const parsed: unknown = JSON.parse(contents);
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error(`${path} is not a package manifest`);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structurally checked above
  return parsed as PackageJson;
}

function bump(version: string, request: string): string {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(request)) return request;

  const parts = version.split(".").map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  switch (request) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`not a bump keyword or exact version: "${request}"`);
  }
}
