// Refuses a release unless the tree is clean (not checked in CI), the tag (when given) equals
// the package.json version, CHANGELOG.md has a dated, non-empty entry for that version and the
// packed file list is limited to the publishable set (plan: Releases).
// Usage: node scripts/release-check.ts [vX.Y.Z]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { releaseProblems } from "./lib/release-rules.ts";

const tag = process.argv[2];
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const packed = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const { files } = JSON.parse(packed.slice(packed.indexOf("{"))) as { files: { path: string }[] };

const problems = releaseProblems({
  status: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }),
  version,
  changelog: readFileSync("CHANGELOG.md", "utf8"),
  packedFiles: files.map((file) => file.path),
  ...(tag === undefined ? {} : { tag }),
  ci: process.env.GITHUB_ACTIONS === "true",
});

if (problems.length > 0) {
  console.error(`release:check refused v${version}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`release:check passed for v${version} (${files.length} files packed)`);
