// @vitest-environment node
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { build as tsup, type Options } from "tsup";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import tsupConfig from "../../tsup.config.ts";
import { baseConfig } from "./fixtures";

// A real `astro build` of a minimal site at the lowest supported Astro (`astro-min`, pinned with
// the Vite it is tested against) and at the current one (plan: Astro integration).

const repo = process.cwd();
const require = createRequire(join(repo, "package.json"));
const dirs: string[] = [];
let pkg = "";

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consent-astro-"));
  dirs.push(dir);
  return dir;
}

// The package as published: package.json plus a fresh dist/, so the test never depends on a
// stale or missing build (check:test runs before check:build).
beforeAll(async () => {
  pkg = await tempDir();
  await cp(join(repo, "package.json"), join(pkg, "package.json"));
  await symlink(join(repo, "node_modules"), join(pkg, "node_modules"));
  for (const options of tsupConfig as Options[]) {
    await tsup({ ...options, config: false, dts: false, silent: true, outDir: join(pkg, "dist") });
  }
}, 120_000);

afterAll(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const { locales, ...rest } = baseConfig();
const CONFIGS = {
  // Split across a JSON strings file, as a site with translated copy would be.
  valid: `import strings from "./strings.json";\nexport default { ...${JSON.stringify(rest)}, locales: { en: strings } };\n`,
  adapters: `import strings from "./strings.json";\nexport default { ...${JSON.stringify(rest)}, locales: { en: strings }, gateScripts: true, consentMode: { mapping: { analytics: ["analytics_storage"] } } };\n`,
  invalid: `import strings from "./strings.json";\nexport default { ...${JSON.stringify(rest)}, locales: { en: strings }, gpc: true };\n`,
};

async function site(astroPackage: string, config: keyof typeof CONFIGS): Promise<string> {
  const dir = await tempDir();
  await mkdir(join(dir, "src/pages"), { recursive: true });
  await writeFile(join(dir, "package.json"), `{ "name": "site", "type": "module" }\n`);
  await writeFile(
    join(dir, "astro.config.mjs"),
    `import { defineConfig } from "astro/config";\nimport consent from "@edgesweden/consent/astro";\nexport default defineConfig({ integrations: [consent({ config: "./src/consent.config.ts" })] });\n`,
  );
  await writeFile(
    join(dir, "src/pages/index.astro"),
    `---\n---\n<html lang="en"><head><title>Fixture</title></head><body><h1>Fixture</h1></body></html>\n`,
  );
  await writeFile(join(dir, "src/strings.json"), JSON.stringify(locales.en));
  await writeFile(join(dir, "src/consent.config.ts"), CONFIGS[config]);
  await mkdir(join(dir, "node_modules/@edgesweden"), { recursive: true });
  await symlink(pkg, join(dir, "node_modules/@edgesweden/consent"));
  await symlink(
    dirname(require.resolve(`${astroPackage}/package.json`)),
    join(dir, "node_modules/astro"),
  );
  return dir;
}

function build(dir: string) {
  // The CLI path moved between majors (astro.js in 5, bin/astro.mjs in 7); read it from `bin`.
  const astro = join(dir, "node_modules/astro");
  const { bin } = require(join(astro, "package.json")) as { bin: { astro: string } };
  return promisify(execFile)(process.execPath, [join(astro, bin.astro), "build"], {
    cwd: dir,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
  });
}

async function pageScripts(dir: string): Promise<{ html: string; js: string[] }> {
  const html = await readFile(join(dir, "dist/index.html"), "utf8");
  const sources = [
    ...html.matchAll(/<script type="module" src="(\/_astro\/[^"]+\.js)"><\/script>/g),
  ];
  const js = await Promise.all(sources.map(([, src]) => readFile(join(dir, "dist", src!), "utf8")));
  return { html, js };
}

function versions(astroPackage: string): { astro: string; vite: string } {
  const astro = require.resolve(`${astroPackage}/package.json`);
  const vite = createRequire(astro).resolve("vite/package.json");
  return {
    astro: (require(astro) as { version: string }).version,
    vite: (require(vite) as { version: string }).version,
  };
}

test("astro-min pins the lowest supported Astro and the Vite it is tested with", () => {
  expect(versions("astro-min")).toEqual({ astro: "5.4.0", vite: "6.2.0" });
});

describe.each(["astro-min", "astro"])("astro build with %s", (astroPackage) => {
  test("links the stylesheet and exactly one page script that mounts the banner", async () => {
    const dir = await site(astroPackage, "valid");
    await build(dir);
    const { html, js } = await pageScripts(dir);
    expect(html).toMatch(/<link rel="stylesheet" href="\/_astro\/[^"]+\.css"/);
    expect(js).toHaveLength(1);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(js[0]).toContain("Accept all");
    expect(js[0]).not.toContain("dataLayer");
    expect((await readdir(join(dir, "dist/_astro"))).some((f) => f.endsWith(".css"))).toBe(true);
  }, 120_000);

  test("bundles the adapters the config asks for into the one page script", async () => {
    const dir = await site(astroPackage, "adapters");
    await build(dir);
    const { js } = await pageScripts(dir);
    expect(js).toHaveLength(1);
    expect(js[0]).toContain("Accept all");
    expect(js[0]).toContain("dataLayer");
  }, 120_000);

  test("fails on an invalid config and writes no site", async () => {
    const dir = await site(astroPackage, "invalid");
    const output = await build(dir).then(
      () => "",
      (error: { stdout: string; stderr: string }) => error.stdout + error.stderr,
    );
    expect(output).toMatch(
      /@edgesweden\/consent: invalid config in \.\/src\/consent\.config\.ts[\s\S]*gpc/,
    );
    await expect(readdir(join(dir, "dist"))).rejects.toThrow();
  }, 120_000);
});
