import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AstroIntegration } from "astro";
import type { ConsentConfig } from "./schema";
import { validateConfig, type ValidationIssue } from "./validate";

export interface ConsentIntegrationOptions {
  /**
   * Path to the module whose default export is the consent config, relative to the project root
   * or absolute.
   */
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

type RunnerImport = (
  path: string,
  config: {
    root: string;
    configFile: false;
    logLevel: "silent";
    plugins: Array<{
      name: string;
      enforce: "pre";
      transform: (code: string, id: string) => undefined;
    }>;
  },
) => Promise<{ module: Record<string, unknown>; dependencies: string[] }>;

/**
 * Vite's module runner from the Vite the site's own Astro uses: Vite is Astro's dependency, not
 * ours. `runnerImport` arrived in Vite 6.1, which Astro requires from 5.4.
 */
async function loadRunnerImport(root: string): Promise<RunnerImport> {
  const astro = createRequire(join(root, "package.json")).resolve("astro");
  const vite = (await import(
    /* @vite-ignore */ pathToFileURL(createRequire(astro).resolve("vite")).href
  )) as { runnerImport?: unknown };
  if (typeof vite.runnerImport !== "function") {
    throw new Error(`${PACKAGE}/astro needs Astro >= 5.4.`);
  }
  return vite.runnerImport as RunnerImport;
}

/**
 * Loads the config module through Vite's module runner (TypeScript, relative imports with or
 * without extensions, JSON, installed packages), without the site's Vite or Astro configuration
 * (`configFile: false`), so path aliases and `.env` values are not available. A config module
 * that mentions `import.meta.env` is refused before Vite replaces it, on every supported Vite,
 * because the value validated here would not be the one the browser bundle ships. Returns the
 * default export and every file the module imported.
 */
async function loadConfig(
  root: string,
  path: string,
  name: string,
): Promise<{ config: unknown; dependencies: string[] }> {
  const runnerImport = await loadRunnerImport(root);
  let loaded: Awaited<ReturnType<RunnerImport>>;
  try {
    loaded = await runnerImport(path, {
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: `${PACKAGE}:no-env`,
          enforce: "pre",
          transform: (code, id) => {
            if (!/[\\/]node_modules[\\/]/.test(id) && /\bimport\.meta\.env\b/.test(code)) {
              throw new Error(`import.meta.env is not available in the consent config (${id})`);
            }
            return undefined;
          },
        },
      ],
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${PACKAGE}: cannot load ${name}: ${reason}`, { cause });
  }
  if (!("default" in loaded.module)) throw new Error(`${PACKAGE}: ${name} has no default export`);
  return { config: loaded.module.default, dependencies: loaded.dependencies };
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
        config: astroConfig,
        updateConfig,
        injectScript,
        addWatchFile,
        logger,
      }) => {
        const root = fileURLToPath(astroConfig.root);
        const path = isAbsolute(options.config) ? options.config : resolve(root, options.config);
        const loaded = await loadConfig(root, path, options.config);
        // A change to the config or to anything it imports restarts `astro dev`, which
        // revalidates.
        for (const file of new Set([path, ...loaded.dependencies])) addWatchFile(file);
        const result = validateConfig(loaded.config);
        for (const warning of result.warnings) logger.warn(describe(warning));
        if (!result.ok) {
          throw new Error(
            `${PACKAGE}: invalid config in ${options.config}:\n` +
              result.errors.map((issue) => `  - ${describe(issue)}`).join("\n"),
          );
        }
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
