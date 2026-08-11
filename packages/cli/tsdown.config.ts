import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    platform: "node",
    tsconfig: "./tsconfig.build.json",
    exports: true,
    publint: true,
    failOnWarn: true,
    sourcemap: true,
    dts: { sourcemap: true },
    deps: { neverBundle: true },
  },
  {
    // The bin pulls in TaggedErrorClass classes, whose extends-expression
    // shape isolatedDeclarations cannot emit — so no dts for this entry.
    entry: { cli: "src/cli.ts" },
    platform: "node",
    tsconfig: "./tsconfig.build.json",
    exports: { bin: { forge: "src/cli.ts" } },
    publint: true,
    failOnWarn: true,
    sourcemap: true,
    dts: false,
    deps: { neverBundle: true },
  },
]);
