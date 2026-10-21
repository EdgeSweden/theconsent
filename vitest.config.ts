import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
  test: {
    environment: "happy-dom",
    include: ["test/unit/**/*.test.ts"],
  },
});
