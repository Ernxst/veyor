import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["import"],
  rules: {
    "import/no-cycle": "error",
    "import/no-self-import": "error",
    "package-boundaries/no-cross-package-path-imports": "error",
    "package-boundaries/no-invalid-workspace-imports": "error",
  },
  overrides: [
    {
      files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"],
      jsPlugins: ["@forge/oxlint/plugins/package-boundaries"],
    },
  ],
});
