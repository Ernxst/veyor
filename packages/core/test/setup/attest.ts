import { setup } from "@ark/attest";

export default () =>
  setup({
    tsconfig: "tsconfig.json",
    benchPercentThreshold: 0,
    benchErrorOnThresholdExceeded: "types",
    failOnMissingSnapshots: true,
    formatCmd: "bun x oxfmt",
    shouldFormat: true,
  });
