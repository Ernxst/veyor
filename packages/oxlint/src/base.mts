import { defineConfig } from "oxlint";
import jsdocConfig from "./jsdoc.mts";
import packageBoundariesConfig from "./package-boundaries.mts";
import styleConfig from "./style.mts";
import typescriptConfig from "./typescript.mts";
import vitestConfig from "./vitest.mts";

export default defineConfig({
  extends: [jsdocConfig, packageBoundariesConfig, styleConfig, typescriptConfig, vitestConfig],
  plugins: ["unicorn"],
  ignorePatterns: ["dist", "node_modules"],
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
  },
});
