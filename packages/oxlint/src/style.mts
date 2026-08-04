import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["oxc"],
  rules: {
    "complexity/complexity": [
      "error",
      {
        cyclomatic: 5,
        cognitive: 6,
      },
    ],
    "max-depth": ["error", 3],
    "max-nested-callbacks": ["error", 3],
    "max-params": ["error", 4],
    "no-extra-boolean-cast": "error",
    "no-unused-vars": [
      "error",
      {
        varsIgnorePattern: "^_",
        argsIgnorePattern: "^_",
        fix: {
          imports: "fix",
          variables: "off",
        },
      },
    ],
    "oxc/no-accumulating-spread": "error",
    "style/prefer-concise-arrow": "error",
  },
  overrides: [
    {
      files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"],
      jsPlugins: ["oxlint-plugin-complexity", "@forge/oxlint/plugins/style"],
    },
    {
      files: [
        "**/plugins/*.mts",
        "**/*.{test,spec}.{ts,tsx,js,jsx}",
        "**/__tests__/**/*.{ts,tsx,js,jsx}",
      ],
      rules: {
        "complexity/complexity": "off",
      },
    },
  ],
});
