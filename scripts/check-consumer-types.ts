// Type-checks the packed tarball from a consumer project that has zod but not Astro, the optional
// peer: the browser entries' typings must not need it (plan: Repository layout, Adapters).
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const project = mkdtempSync(join(tmpdir(), "consent-consumer-"));
try {
  execFileSync("pnpm", ["pack", "--pack-destination", project], { stdio: "ignore" });
  const tarball = readdirSync(project).find((file) => file.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("pnpm pack produced no tarball");

  const pkgDir = join(project, "node_modules", "@edgesweden", "consent");
  mkdirSync(pkgDir, { recursive: true });
  execFileSync("tar", ["-xzf", join(project, tarball), "-C", pkgDir, "--strip-components=1"]);
  symlinkSync(
    realpathSync(resolve(root, "node_modules", "zod")),
    join(project, "node_modules", "zod"),
    "dir",
  );

  writeFileSync(
    join(project, "consumer.ts"),
    [
      `import { getConsent, mount, onConsent, type ConsentConfig } from "@edgesweden/consent";`,
      `import { install as installGate, installScriptGating } from "@edgesweden/consent/gate";`,
      `import { install as installGtag, installConsentMode } from "@edgesweden/consent/gtag";`,
      `declare const config: ConsentConfig;`,
      `mount(config);`,
      `const stop: () => void = installScriptGating(config);`,
      `installConsentMode(config)();`,
      `installGate(config);`,
      `installGtag(config);`,
      `onConsent((state) => state.categories["analytics"] === true);`,
      `const at: number | null | undefined = getConsent()?.at;`,
      `export { stop, at };`,
    ].join("\n"),
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM"],
        types: [],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ["consumer.ts"],
    }),
  );
  execFileSync(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", project],
    {
      stdio: "inherit",
    },
  );
  console.log("packed typings: ., ./gate and ./gtag type-check without astro installed");
} catch (error) {
  console.error("packed typings failed to type-check without astro installed");
  process.exitCode = 1;
  if (!(error instanceof Error && "status" in error)) console.error(error);
} finally {
  rmSync(project, { recursive: true, force: true });
}
