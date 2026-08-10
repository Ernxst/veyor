import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  platform: "node",
  tsconfig: "./tsconfig.build.json",
  exports: { bin: { forge: "src/cli.ts" } },
  publint: true,
  failOnWarn: true,
  sourcemap: true,
  dts: false,
  deps: { neverBundle: true },
});
