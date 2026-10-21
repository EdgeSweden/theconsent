import { readFileSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

/** Options shared by the browser build and the build-time ./astro build. */
const common: Options = {
  format: "esm",
  target: "es2022",
  platform: "neutral",
  dts: true,
  clean: false,
  // No shared chunks: check:size scans each browser entry file and does not follow ./ imports.
  splitting: false,
  treeshake: true,
  minify: true,
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
  external: ["astro", "zod", /^node:/],
  esbuildPlugins: [
    {
      // The core imports the stylesheet so bundlers ship it with the script; keep that import
      // as an external side-effect import of the copied asset instead of inlining it.
      name: "external-stylesheet",
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, () => ({ path: "./styles.css", external: true }));
      },
    },
    {
      // Adapters subscribe through the core's own module instance, never a bundled copy, so
      // `onConsent` sees the state that `mount` created (plan: Adapters).
      name: "external-core",
      setup(build) {
        build.onResolve({ filter: /^\.\.\/core\/index$/ }, (args) =>
          /[\\/]src[\\/](gate|gtag)[\\/]/.test(args.importer)
            ? { path: "./index.js", external: true }
            : undefined,
        );
      },
    },
  ],
};

export default defineConfig([
  {
    // Browser entries. Their declarations are bundled apart from ./astro so no browser typing
    // ever references ./astro.js, which imports the optional peer `astro`.
    ...common,
    entry: {
      index: "src/core/index.ts",
      gate: "src/gate/index.ts",
      gtag: "src/gtag/index.ts",
    },
  },
  {
    ...common,
    entry: { astro: "src/astro/index.ts" },
  },
  {
    // The stylesheet ships minified as its own asset (plan: No visual flash, CSP).
    entry: { styles: "src/styles.css" },
    minify: true,
    clean: false,
  },
]);
