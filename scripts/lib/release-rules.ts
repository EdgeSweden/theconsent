/** Pure release refusal rules (plan: Releases), shared by `release:check` and its tests. */

export const PACKABLE_FILES = ["package.json", "README.md", "LICENSE", "CHANGELOG.md"];

export interface ReleaseInput {
  /** `git status --porcelain` output. */
  status: string;
  version: string;
  changelog: string;
  /** Paths listed by `pnpm pack --dry-run`. */
  packedFiles: string[];
}

export function releaseProblems({
  status,
  version,
  changelog,
  packedFiles,
}: ReleaseInput): string[] {
  const problems: string[] = [];
  if (status.trim() !== "") problems.push(`working tree is not clean:\n${status.trim()}`);

  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
    problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" entry`);
  }

  const outside = packedFiles.filter(
    (path) => !path.startsWith("dist/") && !PACKABLE_FILES.includes(path),
  );
  if (outside.length > 0) {
    problems.push(`pack lists files outside the allowed set: ${outside.join(", ")}`);
  }
  for (const required of PACKABLE_FILES) {
    if (!packedFiles.includes(required)) problems.push(`pack is missing ${required}`);
  }
  if (!packedFiles.some((path) => path.startsWith("dist/"))) {
    problems.push("pack contains no dist/ files");
  }
  return problems;
}
