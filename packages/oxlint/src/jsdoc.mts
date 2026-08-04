import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["import", "jsdoc"],
  rules: {
    "jsdoc/check-tag-names": "error",
    "jsdoc/require-param-description": "error",
    "jsdoc/require-returns-description": "error",
  },
});
