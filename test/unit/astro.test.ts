import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
async function setup(source: string, file = "consent.config.mjs") {
  // Inside the repository: vitest's module runner only loads files under its root.
  mkdirSync(TMP, { recursive: true });
  const root = mkdtempSync(join(TMP, "project-"));
  writeFileSync(join(root, file), source);
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
    await expect(s.run()).rejects.toThrow(/has no default export/);
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
