/** Pure release refusal rules (plan: Releases), shared by `release:check` and its tests. */

export const PACKABLE_FILES = ["package.json", "README.md", "LICENSE", "CHANGELOG.md"];

export interface ReleaseInput {
  /** `git status --porcelain` output. */
  status: string;
  version: string;
  changelog: string;
  /** Paths listed by `pnpm pack --dry-run`. */
  packedFiles: string[];
  /** The release tag (`vX.Y.Z`) when one is checked, as the release workflow does. */
  tag?: string;
  /** Running in CI, where the checkout is clean by construction: the tree is not checked. */
  ci?: boolean;
}

export function releaseProblems({
  status,
  version,
  changelog,
  packedFiles,
  tag,
  ci = false,
}: ReleaseInput): string[] {
  const problems: string[] = [];
  if (!ci && status.trim() !== "") problems.push(`working tree is not clean:\n${status.trim()}`);

  if (tag !== undefined) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) problems.push(`tag "${tag}" is not vX.Y.Z`);
    else if (tag !== `v${version}`) {
      problems.push(`tag ${tag} does not match package.json version ${version}`);
    }
  }

  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = changelog.split("\n");
  const heading = lines.findIndex((line) =>
    new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`).test(line),
  );
  if (heading === -1) {
    problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" entry`);
  } else {
    const next = lines.findIndex((line, i) => i > heading && line.startsWith("## "));
    const body = lines.slice(heading + 1, next === -1 ? undefined : next);
    if (!body.some((line) => /^\s*- \S/.test(line))) {
      problems.push(`the CHANGELOG.md entry for ${version} lists no changes`);
    }
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
    problems.push("pack contains no dist/ files (run pnpm build first)");
  }
  return problems;
}
