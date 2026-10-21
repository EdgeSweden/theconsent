// Fails when a browser entry in dist/ imports anything but its own relative files
// (plan: Repository layout, "zero runtime dependencies").
import { existsSync, readFileSync } from "node:fs";
import { externalImports } from "./lib/bundle-imports.ts";

/** Browser entries. Adapters may import only the core entry, "./index.js". */
export const BROWSER_ENTRIES = ["dist/index.js", "dist/gate.js", "dist/gtag.js"];

let failed = false;
for (const entry of BROWSER_ENTRIES) {
  if (!existsSync(entry)) {
    console.error(`${entry}: missing; run pnpm build first`);
    failed = true;
    continue;
  }
  const external = externalImports(readFileSync(entry, "utf8"));
  if (external.length > 0) {
    console.error(`${entry}: imports runtime dependencies: ${external.join(", ")}`);
    failed = true;
  } else {
    console.log(`${entry}: no runtime dependencies`);
  }
}
process.exit(failed ? 1 : 0);
