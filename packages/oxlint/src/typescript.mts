import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["typescript"],
  options: {
    typeAware: true,
  },
  rules: {
    "typescript/adjacent-overload-signatures": "error",
    "typescript/ban-ts-comment": [
      "error",
      {
        minimumDescriptionLength: 10,
        "ts-check": false,
        "ts-expect-error": "allow-with-description",
        "ts-ignore": true,
        "ts-nocheck": true,
      },
    ],
    "typescript/consistent-type-exports": "error",
    "typescript/consistent-type-imports": [
      "error",
      {
        disallowTypeAnnotations: false,
        fixStyle: "separate-type-imports",
        prefer: "type-imports",
      },
    ],
    "typescript/no-deprecated": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-import-type-side-effects": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-unnecessary-condition": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-declaration-merging": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/switch-exhaustiveness-check": "error",
  },
  overrides: [
    {
      files: ["src/**/*.{ts,tsx}"],
      rules: {
        "typescript/explicit-module-boundary-types": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-call": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-return": "error",
        "typescript/only-throw-error": [
          "error",
          {
            allowRethrowing: true,
            allowThrowingAny: false,
            allowThrowingUnknown: false,
          },
        ],
        "typescript/strict-boolean-expressions": [
          "error",
          {
            allowAny: false,
            allowNullableBoolean: false,
            allowNullableEnum: false,
            allowNullableNumber: false,
            allowNullableObject: false,
            allowNullableString: false,
            allowNumber: false,
            allowString: false,
          },
        ],
      },
    },
  ],
});
