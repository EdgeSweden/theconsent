// Refuses a local release unless the tree is clean, the CHANGELOG has an entry for the
// package.json version and the packed file list is limited to the publishable set
// (plan: Releases).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { releaseProblems } from "./lib/release-rules.ts";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const packed = execFileSync("pnpm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const { files } = JSON.parse(packed.slice(packed.indexOf("{"))) as { files: { path: string }[] };

const problems = releaseProblems({
  status: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }),
  version,
  changelog: readFileSync("CHANGELOG.md", "utf8"),
  packedFiles: files.map((file) => file.path),
});

if (problems.length > 0) {
  console.error(`release:check refused v${version}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`release:check passed for v${version} (${files.length} files packed)`);
