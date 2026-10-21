import { describe, expect, test } from "vitest";
import { releaseProblems, type ReleaseInput } from "../../scripts/lib/release-rules.ts";

const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-10-20\n\n### Added\n";
const good: ReleaseInput = {
  status: "",
  version: "0.1.0",
  changelog,
  packedFiles: ["CHANGELOG.md", "LICENSE", "README.md", "dist/index.js", "package.json"],
};

describe("releaseProblems", () => {
  test("passes a clean tree with a changelog entry and the allowed file set", () => {
    expect(releaseProblems(good)).toEqual([]);
  });
  test("refuses a dirty working tree", () => {
    expect(releaseProblems({ ...good, status: " M src/core/index.ts\n" })).toEqual([
      expect.stringMatching(/not clean/),
    ]);
  });
  test("refuses when CHANGELOG has no entry for the version", () => {
    expect(releaseProblems({ ...good, version: "0.2.0" })).toEqual([
      expect.stringMatching(/no "## \[0\.2\.0\]/),
    ]);
  });
  test("an Unreleased-only or undated entry does not count", () => {
    expect(releaseProblems({ ...good, changelog: "## [0.1.0]\n" })).toHaveLength(1);
    expect(releaseProblems({ ...good, changelog: "## [0.1.0.1] - 2026-10-20\n" })).toHaveLength(1);
  });
  test("refuses packed files outside dist/ and the top-level allow list", () => {
    expect(
      releaseProblems({ ...good, packedFiles: [...good.packedFiles, "src/core/index.ts"] }),
    ).toEqual([expect.stringMatching(/outside the allowed set: src\/core\/index\.ts/)]);
  });
  test("refuses a pack missing CHANGELOG.md or dist/", () => {
    expect(
      releaseProblems({ ...good, packedFiles: ["LICENSE", "README.md", "package.json"] }),
    ).toEqual([expect.stringMatching(/missing CHANGELOG\.md/), expect.stringMatching(/no dist/)]);
  });
});

describe("package files", () => {
  test("pnpm pack includes every top-level file release:check requires", async () => {
    const { execFileSync } = await import("node:child_process");
    const packed = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
    const { files } = JSON.parse(packed.slice(packed.indexOf("{"))) as {
      files: { path: string }[];
    };
    const paths = files.map((file) => file.path);
    for (const required of ["package.json", "README.md", "LICENSE", "CHANGELOG.md"]) {
      expect(paths).toContain(required);
    }
  });
});
