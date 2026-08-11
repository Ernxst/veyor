import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cursor.ts"],
  platform: "neutral",
  tsconfig: "./tsconfig.build.json",
  exports: true,
  publint: true,
  sourcemap: true,
  dts: { sourcemap: true },
  deps: { neverBundle: true },
  attw: { profile: "esm-only", level: "error" },
});
