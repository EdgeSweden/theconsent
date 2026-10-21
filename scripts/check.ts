// Runs the local check gate (plan: Checks) in order and stops at the first failure.
import { spawnSync } from "node:child_process";

const checks: Array<[name: string, command: string]> = [
  ["check:types", "pnpm type-check"],
  ["check:lint", "pnpm lint"],
  ["check:format", "pnpm format:check"],
  ["check:test", "pnpm test"],
  ["check:deps", "pnpm audit --prod --audit-level=high"],
  ["check:build", "pnpm build"],
  ["check:size", "pnpm size"],
  ["check:e2e", "pnpm test:e2e"],
];

const summary: string[] = [];
for (const [name, command] of checks) {
  const started = Date.now();
  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  summary.push(`${ok ? "pass" : "FAIL"}  ${name.padEnd(13)} ${command} (${seconds}s)`);
  if (!ok) break;
}

console.log("\npnpm check summary");
for (const line of summary) console.log(`  ${line}`);
const failed = summary.length < checks.length || summary.some((line) => line.startsWith("FAIL"));
console.log(failed ? "result: FAILED" : "result: all checks green");
process.exit(failed ? 1 : 0);
