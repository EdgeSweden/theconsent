import { expect, test } from "vitest";

test("package version is injected at build time", () => {
  expect(__PACKAGE_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
});
