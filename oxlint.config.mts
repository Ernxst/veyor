import base from "@veyor/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [base],
  ignorePatterns: [".agents"],
  overrides: [
    {
      files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"],
      jsPlugins: ["eslint-plugin-turbo"],
      rules: {
        "turbo/no-undeclared-env-vars": "error",
      },
    },
  ],
});
