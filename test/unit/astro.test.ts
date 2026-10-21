// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, test, vi } from "vitest";
import consent, { pageScript, VIRTUAL_CONFIG } from "../../src/astro/index";
import { baseConfig } from "./fixtures";

type Setup = Extract<
  NonNullable<ReturnType<typeof consent>["hooks"]["astro:config:setup"]>,
  (...args: never[]) => unknown
>;

const TMP = resolve(process.cwd(), "test/.tmp");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** Writes `source` as a config module in a temp project and runs the setup hook on it. */
async function setup(
  source: string,
  file = "consent.config.mjs",
  extra: Record<string, string> = {},
) {
  // Inside the repository: vitest's module runner only loads files under its root.
  mkdirSync(TMP, { recursive: true });
  const root = mkdtempSync(join(TMP, "project-"));
  writeFileSync(join(root, file), source);
  for (const [name, content] of Object.entries(extra)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  const injectScript = vi.fn();
  const updateConfig = vi.fn();
  const addWatchFile = vi.fn();
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const hook = consent({ config: `./${file}` }).hooks["astro:config:setup"] as Setup;
  const run = () =>
    hook({
      command: "build",
      config: { root: pathToFileURL(`${root}/`) },
      injectScript,
      updateConfig,
      addWatchFile,
      logger,
    } as never);
  return { root, path: join(root, file), run, injectScript, updateConfig, addWatchFile, logger };
}

const moduleFor = (config: unknown) => `export default ${JSON.stringify(config)};\n`;

describe("Astro integration", () => {
  test("a valid config injects one page script and registers the virtual module", async () => {
    const s = await setup(moduleFor(baseConfig()));
    await s.run();
    expect(s.injectScript.mock.calls).toEqual([
      ["page-ssr", `import "@edgesweden/consent/styles.css";`],
      ["page", pageScript({})],
    ]);
    expect(pageScript({})).toContain(`from "${VIRTUAL_CONFIG}"`);
    expect(pageScript({})).toContain(`import { mount } from "@edgesweden/consent"`);
    expect(s.addWatchFile).toHaveBeenCalledWith(s.path);

    const plugin = s.updateConfig.mock.calls[0]![0].vite.plugins[0];
    const resolved = plugin.resolveId(VIRTUAL_CONFIG);
    expect(resolved).toBe(`\0${VIRTUAL_CONFIG}`);
    expect(plugin.resolveId("other")).toBeUndefined();
    expect(plugin.load(resolved)).toBe(`export { default } from ${JSON.stringify(s.path)};`);
    expect(plugin.load("other")).toBeUndefined();
  });

  test("an invalid config fails the build, naming each offending key", async () => {
    const config = { ...baseConfig(), policyVersion: "", extra: true };
    const s = await setup(moduleFor(config));
    await expect(s.run()).rejects.toThrow(/policyVersion: .*\n.*extra: unknown key/s);
    expect(s.injectScript).not.toHaveBeenCalled();
    expect(s.updateConfig).not.toHaveBeenCalled();
  });

  test("a cross-field error fails the build", async () => {
    const config = { ...baseConfig(), defaultLocale: "de" };
    const s = await setup(moduleFor(config));
    await expect(s.run()).rejects.toThrow(/defaultLocale: "de" is not a key of locales/);
  });

  test("contrast warnings are logged and do not fail the build", async () => {
    const config = { ...baseConfig(), theme: { colors: { text: "#bbbbbb" } } };
    const s = await setup(moduleFor(config));
    await s.run();
    expect(s.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^theme\.colors\.text: contrast/),
    );
    expect(s.injectScript).toHaveBeenCalled();
  });

  test("strictContrast turns the warning into a build failure", async () => {
    const config = {
      ...baseConfig(),
      theme: { colors: { text: "#bbbbbb" } },
      validation: { strictContrast: true },
    };
    const s = await setup(moduleFor(config));
    await expect(s.run()).rejects.toThrow(/theme\.colors\.text: contrast/);
  });

  test("a function recorder survives: the virtual module re-exports the module itself", async () => {
    const source = `const config = ${JSON.stringify(baseConfig())};\nconfig.record = () => {};\nexport default config;\n`;
    const s = await setup(source);
    await s.run();
    const plugin = s.updateConfig.mock.calls[0]![0].vite.plugins[0];
    expect(plugin.load(plugin.resolveId(VIRTUAL_CONFIG))).toContain(JSON.stringify(s.path));
  });

  test("a TypeScript config module is loaded", async () => {
    const source = `import type { ConsentConfig } from "@edgesweden/consent";\nconst config: ConsentConfig = ${JSON.stringify(baseConfig())};\nexport default config;\n`;
    const s = await setup(source, "consent.config.ts");
    await s.run();
    expect(s.injectScript).toHaveBeenCalled();
  });

  test("a module without a default export fails clearly", async () => {
    const s = await setup(`export const config = {};\n`);
    await expect(s.run()).rejects.toThrow(
      /^@edgesweden\/consent: \.\/consent\.config\.mjs has no default export/,
    );
  });

  describe("config loading through Vite's module runner", () => {
    const { locales, ...rest } = baseConfig();
    const splitConfig = [
      `import type { ConsentConfig } from "@edgesweden/consent";`,
      `import { z } from "zod";`,
      `import strings from "./strings/en.json";`,
      `import { policyVersion } from "./policy";`,
      `const config: ConsentConfig = { ...${JSON.stringify(rest)}, policyVersion: z.string().parse(policyVersion), locales: { en: strings } };`,
      `export default config;`,
    ].join("\n");
    const splitFiles = {
      "strings/en.json": JSON.stringify(locales.en),
      "policy.ts": `export const policyVersion: string = "from-module";\n`,
    };

    test("a TypeScript config importing JSON, an extensionless module and a package loads", async () => {
      const s = await setup(splitConfig, "consent.config.ts", splitFiles);
      await s.run();
      expect(s.injectScript).toHaveBeenCalledWith("page", pageScript({}));
    });

    test("the config and every module it imports are watched", async () => {
      const s = await setup(splitConfig, "consent.config.ts", splitFiles);
      await s.run();
      const watched = s.addWatchFile.mock.calls.map(([file]) => resolve(String(file)));
      expect(watched).toEqual(
        expect.arrayContaining([
          s.path,
          join(s.root, "strings/en.json"),
          join(s.root, "policy.ts"),
        ]),
      );
      expect(new Set(watched).size).toBe(watched.length);
    });

    test("an edited dependency is picked up on the next load", async () => {
      const s = await setup(splitConfig, "consent.config.ts", splitFiles);
      await s.run();
      writeFileSync(join(s.root, "policy.ts"), `export const policyVersion: string = "";\n`);
      await expect(s.run()).rejects.toThrow(/policyVersion/);
    });

    describe.each(["astro", "astro-min"])("with %s", (astroPackage) => {
      test.each([
        ["a PUBLIC_ value", `import.meta.env.PUBLIC_POLICY ?? "2026-10"`],
        ["PROD", `import.meta.env.PROD ? "2026-10" : "dev"`],
      ])("a config that reads import.meta.env (%s) fails to load", async (_, expression) => {
        const source = `export default { ...${JSON.stringify(baseConfig())}, policyVersion: ${expression} };\n`;
        const s = await setup(source, "consent.config.ts", { ".env": "PUBLIC_POLICY=from-env\n" });
        // Load through the Astro (and so the Vite) under test.
        const astro = dirname(
          createRequire(join(TMP, "x")).resolve(`${astroPackage}/package.json`),
        );
        mkdirSync(join(s.root, "node_modules"), { recursive: true });
        symlinkSync(astro, join(s.root, "node_modules/astro"));
        await expect(s.run()).rejects.toThrow(
          /^@edgesweden\/consent: cannot load \.\/consent\.config\.ts: .*import\.meta\.env is not available/s,
        );
        expect(s.injectScript).not.toHaveBeenCalled();
      });
    });

    test("an absolute config path is accepted", async () => {
      const s = await setup(moduleFor(baseConfig()));
      const hook = consent({ config: s.path }).hooks["astro:config:setup"] as Setup;
      await hook({
        config: { root: pathToFileURL(`${s.root}/`) },
        injectScript: s.injectScript,
        updateConfig: s.updateConfig,
        addWatchFile: s.addWatchFile,
        logger: s.logger,
      } as never);
      const plugin = s.updateConfig.mock.calls[0]![0].vite.plugins[0];
      expect(plugin.load(plugin.resolveId(VIRTUAL_CONFIG))).toBe(
        `export { default } from ${JSON.stringify(s.path)};`,
      );
    });

    test("an Astro whose Vite has no runnerImport fails with the version requirement", async () => {
      const pkg = (name: string) =>
        JSON.stringify({ name, version: "0.0.0", type: "module", main: "index.js" });
      const s = await setup(moduleFor(baseConfig()), "consent.config.mjs", {
        "node_modules/astro/package.json": pkg("astro"),
        "node_modules/astro/index.js": "export {};\n",
        "node_modules/astro/node_modules/vite/package.json": pkg("vite"),
        "node_modules/astro/node_modules/vite/index.js": `export const version = "6.0.0";\n`,
      });
      await expect(s.run()).rejects.toThrow("@edgesweden/consent/astro needs Astro >= 5.4.");
      expect(s.addWatchFile).not.toHaveBeenCalled();
    });

    test("a module that cannot be loaded fails with the package-prefixed message", async () => {
      const s = await setup(`export default {\n`);
      await expect(s.run()).rejects.toThrow(
        /^@edgesweden\/consent: cannot load \.\/consent\.config\.mjs: /,
      );
      expect(s.injectScript).not.toHaveBeenCalled();
    });

    test("a tsconfig path alias is not resolved (documented limit) and fails clearly", async () => {
      const source = `import strings from "@strings/en.json";\nexport default { ...${JSON.stringify(rest)}, locales: { en: strings } };\n`;
      const s = await setup(source, "consent.config.ts", {
        ...splitFiles,
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@strings/*": ["./strings/*"] } },
        }),
      });
      await expect(s.run()).rejects.toThrow(
        /^@edgesweden\/consent: cannot load \.\/consent\.config\.ts: .*@strings\/en\.json/s,
      );
    });
  });

  test("a missing config file fails the build", async () => {
    const s = await setup(moduleFor(baseConfig()));
    const hook = consent({ config: "./missing.config.mjs" }).hooks["astro:config:setup"] as Setup;
    await expect(
      hook({
        config: { root: pathToFileURL(`${s.root}/`) },
        injectScript: s.injectScript,
        updateConfig: s.updateConfig,
        addWatchFile: s.addWatchFile,
        logger: s.logger,
      } as never),
    ).rejects.toThrow();
  });

  describe("page script per config", () => {
    test("no adapters: mount only, neither adapter entry is imported", () => {
      expect(pageScript({})).toBe(
        [
          `import config from "${VIRTUAL_CONFIG}";`,
          `import { mount } from "@edgesweden/consent";`,
          `mount(config);`,
        ].join("\n"),
      );
      expect(pageScript({ gateScripts: false })).not.toMatch(/\/gate|\/gtag/);
    });
    test("gateScripts true imports ./gate and installs it after mount", () => {
      const script = pageScript({ gateScripts: true });
      expect(script).toContain(
        `import { install as installScriptGating } from "@edgesweden/consent/gate";`,
      );
      expect(script).not.toContain("/gtag");
      expect(script.indexOf("installScriptGating(config);")).toBeGreaterThan(
        script.indexOf("mount(config);"),
      );
    });
    test("consentMode imports ./gtag and installs it after mount", () => {
      const script = pageScript({ consentMode: { mapping: {} } });
      expect(script).toContain(
        `import { install as installConsentMode } from "@edgesweden/consent/gtag";`,
      );
      expect(script).not.toContain("/gate");
      expect(script.indexOf("installConsentMode(config);")).toBeGreaterThan(
        script.indexOf("mount(config);"),
      );
    });
    test("both adapters", () => {
      const script = pageScript({ gateScripts: true, consentMode: { mapping: {} } });
      expect(script.split("\n").slice(-3)).toEqual([
        "mount(config);",
        "installScriptGating(config);",
        "installConsentMode(config);",
      ]);
    });
    test("the hook generates the script from the validated config", async () => {
      const s = await setup(moduleFor({ ...baseConfig(), gateScripts: true }));
      await s.run();
      expect(s.injectScript.mock.calls[1]).toEqual(["page", pageScript({ gateScripts: true })]);
    });
  });
});
