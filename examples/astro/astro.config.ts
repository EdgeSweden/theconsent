import consent from "@edgesweden/consent/astro";
import { defineConfig } from "astro/config";

// DEMO_VARIANT=nonblocking builds the same site in non-blocking mode into dist-nonblocking/.
// DEMO_VARIANT=router builds it with Astro's ClientRouter into dist-router/. Astro's CSP support
// does not cover the ClientRouter, so that build has no CSP.
const variant = process.env.DEMO_VARIANT;
const nonBlocking = variant === "nonblocking";
const router = variant === "router";

export default defineConfig({
  outDir: nonBlocking ? "./dist-nonblocking" : router ? "./dist-router" : "./dist",
  // default-src 'self' also blocks (and reports) any request to another origin.
  security: router ? {} : { csp: { directives: ["default-src 'self'"] } },
  // Shiki highlights with inline styles, which a strict CSP would block.
  markdown: { syntaxHighlight: false },
  integrations: [
    consent({
      config: nonBlocking ? "./src/consent.nonblocking.config.ts" : "./src/consent.config.ts",
    }),
  ],
});
