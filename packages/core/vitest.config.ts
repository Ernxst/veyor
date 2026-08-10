import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "sdk",
    projects: [
      {
        extends: true,
        test: {
          name: "correctness",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: ["**/*.instantiations.test.ts"],
          typecheck: { enabled: true },
        },
      },
      {
        extends: true,
        test: {
          name: "instantiations",
          include: ["**/*.instantiations.test.ts"],
          globalSetup: ["test/setup/attest.ts"],
          maxWorkers: 1,
          disableConsoleIntercept: true,
          typecheck: { enabled: false },
        },
      },
    ],
  },
});
