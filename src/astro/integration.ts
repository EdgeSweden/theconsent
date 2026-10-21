import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AstroIntegration } from "astro";
import type { ConsentConfig } from "./schema";
import { validateConfig, type ValidationIssue } from "./validate";

export interface ConsentIntegrationOptions {
  /** Path to the module whose default export is the consent config, relative to the project root. */
  config: string;
}

/** The virtual module the injected script imports the config from. */
export const VIRTUAL_CONFIG = "virtual:@edgesweden/consent/config";
const RESOLVED_CONFIG = `\0${VIRTUAL_CONFIG}`;

const PACKAGE = "@edgesweden/consent";

const describe = (issue: ValidationIssue): string =>
  `${issue.path === "" ? "(root)" : issue.path}: ${issue.message}`;

/**
 * The page script, generated per config (plan: Astro integration): mount, then install only the
 * adapters the config enables, so a site that uses neither ships neither byte.
 */
export function pageScript(config: Pick<ConsentConfig, "gateScripts" | "consentMode">): string {
  const adapters: Array<[entry: string, local: string]> = [];
  if (config.gateScripts === true) adapters.push(["gate", "installScriptGating"]);
  if (config.consentMode !== undefined) adapters.push(["gtag", "installConsentMode"]);
  return [
    `import config from ${JSON.stringify(VIRTUAL_CONFIG)};`,
    `import { mount } from ${JSON.stringify(PACKAGE)};`,
    ...adapters.map(
      ([entry, local]) =>
        `import { install as ${local} } from ${JSON.stringify(`${PACKAGE}/${entry}`)};`,
    ),
    `mount(config);`,
    ...adapters.map(([, local]) => `${local}(config);`),
  ].join("\n");
}

/**
 * Imports the config module. In `astro dev` a fresh query defeats Node's module cache so an
 * edited config is re-validated on restart.
 */
async function loadConfig(path: string, dev: boolean): Promise<unknown> {
  const url = pathToFileURL(path).href + (dev ? `?t=${Date.now()}` : "");
  const module = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  if (!("default" in module)) throw new Error(`${PACKAGE}: ${path} has no default export`);
  return module.default;
}

/**
 * Astro integration (plan: Astro integration): validates the config at build time, fails the
 * build on error, exposes the config through a virtual module and injects one page script.
 */
export default function consent(options: ConsentIntegrationOptions): AstroIntegration {
  return {
    name: PACKAGE,
    hooks: {
      "astro:config:setup": async ({
        command,
        config: astroConfig,
        updateConfig,
        injectScript,
        addWatchFile,
        logger,
      }) => {
        const path = resolve(fileURLToPath(astroConfig.root), options.config);
        const result = validateConfig(await loadConfig(path, command === "dev"));
        for (const warning of result.warnings) logger.warn(describe(warning));
        if (!result.ok) {
          throw new Error(
            `${PACKAGE}: invalid config in ${options.config}:\n` +
              result.errors.map((issue) => `  - ${describe(issue)}`).join("\n"),
          );
        }
        addWatchFile(path);
        updateConfig({
          vite: {
            plugins: [
              {
                name: `${PACKAGE}:config`,
                resolveId: (id: string) => (id === VIRTUAL_CONFIG ? RESOLVED_CONFIG : undefined),
                load: (id: string) =>
                  id === RESOLVED_CONFIG
                    ? `export { default } from ${JSON.stringify(path)};`
                    : undefined,
              },
            ],
          },
        });
        // CSS imported by a "page" script is bundled but not linked; "page-ssr" imports are how
        // Astro adds a stylesheet to every page (as a CSP-hashed asset).
        injectScript("page-ssr", `import ${JSON.stringify(`${PACKAGE}/styles.css`)};`);
        injectScript("page", pageScript(result.config));
      },
    },
  };
}
