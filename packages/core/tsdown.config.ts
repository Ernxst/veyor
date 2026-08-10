import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    actors: "src/actors/index.ts",
    "schema/*": "src/lib/schema/*.ts",
  },
  platform: "neutral",
  tsconfig: "./tsconfig.build.json",
  exports: true,
  publint: true,
  failOnWarn: true,
  sourcemap: true,
  dts: { sourcemap: true },
  deps: { neverBundle: true },
  attw: { profile: "esm-only", level: "error" },
});
