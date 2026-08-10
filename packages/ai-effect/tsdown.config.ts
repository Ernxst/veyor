import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
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
