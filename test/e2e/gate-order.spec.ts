import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Script-gating order in a real browser (plan: Script gating). The page is served from the built
 * package through request interception, with its own strict CSP that allows the inline gated
 * code by hash, as a site would.
 */
const ORIGIN = "http://127.0.0.1:47821";
const dist = (file: string) => readFileSync(resolve(process.cwd(), "dist", file), "utf8");
const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

const LOG = "(window.order ??= []).push";
const inlineModule = `${LOG}("inline module");`;
const inlineClassic = `${LOG}("inline classic");`;
const inlineClassicLast = `${LOG}("last");`;

const app = `
import { mount } from "./index.js";
import { installScriptGating } from "./gate.js";
const t = { title: "Cookies", description: "d", acceptAll: "Accept all", rejectAll: "Reject all",
  settings: "Settings", save: "Save", close: "Close", alwaysActive: "Always", settingsTitle: "Settings",
  categories: { analytics: { name: "Analytics", description: "" } } };
const config = { schemaVersion: 1, policyVersion: "1", defaultLocale: "en", gateScripts: true,
  categories: [{ id: "analytics" }], locales: { en: t } };
installScriptGating(config);
mount(config);
`;

function html(placeholders: string): string {
  const hashes = [inlineModule, inlineClassic, inlineClassicLast].map(sha256).join(" ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gate order</title>
<meta http-equiv="content-security-policy" content="default-src 'self'; script-src 'self' ${hashes}; style-src 'self'">
<link rel="stylesheet" href="/fixture/styles.css"></head><body><main><h1>Gate order</h1></main>
${placeholders}
<script type="module" src="/fixture/app.js"></script></body></html>`;
}

async function serve(page: Page, placeholders: string): Promise<void> {
  const files: Record<string, [string, string]> = {
    "/fixture/": [html(placeholders), "text/html"],
    // Native ES modules cannot import CSS; the page links the stylesheet itself instead.
    "/fixture/index.js": [
      dist("index.js").replace(/import\s*["']\.\/styles\.css["'];?/, ""),
      "text/javascript",
    ],
    "/fixture/gate.js": [dist("gate.js"), "text/javascript"],
    "/fixture/styles.css": [dist("styles.css"), "text/css"],
    "/fixture/app.js": [app, "text/javascript"],
    "/fixture/slow.js": [`${LOG}("slow classic");`, "text/javascript"],
    "/fixture/fast.js": [`${LOG}("fast classic");`, "text/javascript"],
    "/fixture/module.js": [`${LOG}("external module");`, "text/javascript"],
    "/fixture/legacy.js": [`${LOG}("nomodule");`, "text/javascript"],
    "/fixture/slow-module.js": [`${LOG}("slow module");`, "text/javascript"],
  };
  await page.route(`${ORIGIN}/fixture/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    // A request that never answers: nothing gated after it may depend on it.
    if (path === "/fixture/hang.js") return new Promise<void>(() => {});
    const file = files[path];
    if (!file) return route.fulfill({ status: 404 });
    if (path === "/fixture/slow.js" || path === "/fixture/slow-module.js") {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return route.fulfill({ body: file[0], contentType: file[1] });
  });
  await page.goto(`${ORIGIN}/fixture/`);
}

const gated = (attrs: string, text = "") =>
  `<script type="text/plain" data-consent="analytics" ${attrs}>${text}</script>`;

async function acceptAndRead(page: Page, expectedLength: number): Promise<string[]> {
  await page.getByRole("button", { name: "Accept all" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { order?: string[] }).order?.length ?? 0))
    .toBe(expectedLength);
  await page.waitForTimeout(200);
  return page.evaluate(() => (window as Window & { order?: string[] }).order ?? []);
}

/** `order` restricted to the given entries, keeping their relative order. */
const only = (order: string[], names: string[]) => order.filter((entry) => names.includes(entry));

test("gated scripts keep native order: classic in page order, modules in page order", async ({
  page,
}) => {
  await serve(
    page,
    [
      gated(`src="/fixture/slow.js"`),
      gated(`data-type="module"`, inlineModule),
      gated(``, inlineClassic),
      gated(`data-type="module" src="/fixture/module.js"`),
      gated(`src="/fixture/fast.js"`),
      gated(``, inlineClassicLast),
    ].join("\n"),
  );
  const order = await acceptAndRead(page, 6);
  expect(only(order, ["slow classic", "inline classic", "fast classic", "last"])).toEqual([
    "slow classic",
    "inline classic",
    "fast classic",
    "last",
  ]);
  expect(only(order, ["inline module", "external module"])).toEqual([
    "inline module",
    "external module",
  ]);
  // Nothing after the slow classic script runs before it.
  expect(order[0]).toBe("slow classic");
});

test("a nomodule script is skipped without holding up later scripts", async ({ page }) => {
  await serve(
    page,
    [gated(`src="/fixture/legacy.js" nomodule`), gated(``, inlineClassicLast)].join("\n"),
  );
  expect(await acceptAndRead(page, 1)).toEqual(["last"]);
});

test("nomodule does not apply to modules", async ({ page }) => {
  await serve(
    page,
    [gated(`data-type="module" nomodule`, inlineModule), gated(``, inlineClassicLast)].join("\n"),
  );
  expect((await acceptAndRead(page, 2)).sort()).toEqual(["inline module", "last"]);
});

test("a module after a slow module waits for it", async ({ page }) => {
  await serve(
    page,
    [
      gated(`data-type="module" src="/fixture/slow.js"`),
      gated(`data-type="module"`, inlineModule),
    ].join("\n"),
  );
  expect(await acceptAndRead(page, 2)).toEqual(["slow classic", "inline module"]);
});

test("a slow module does not hold up later classic scripts", async ({ page }) => {
  await serve(
    page,
    [
      gated(`data-type="module" src="/fixture/slow-module.js"`),
      gated(`src="/fixture/fast.js"`),
      gated(``, inlineClassicLast),
    ].join("\n"),
  );
  expect(await acceptAndRead(page, 3)).toEqual(["fast classic", "last", "slow module"]);
});

test("a module that never loads does not stop later classic scripts", async ({ page }) => {
  await serve(
    page,
    [
      gated(`data-type="module" src="/fixture/hang.js"`),
      gated(`src="/fixture/fast.js"`),
      gated(``, inlineClassicLast),
    ].join("\n"),
  );
  expect(await acceptAndRead(page, 2)).toEqual(["fast classic", "last"]);
});

test("activated scripts keep the async attribute exactly as written", async ({ page }) => {
  await serve(
    page,
    [
      gated(`src="/fixture/fast.js" id="plain"`),
      gated(`src="/fixture/slow.js" async id="async"`),
      gated(`id="inline"`, inlineClassicLast),
      gated(`data-type="module" src="/fixture/module.js" id="module"`),
      gated(`data-type="module" src="/fixture/slow-module.js" async id="async-module"`),
    ].join("\n"),
  );
  await acceptAndRead(page, 5);
  const attributes = await page.evaluate(() =>
    ["plain", "async", "inline", "module", "async-module"].map((id) => {
      const script = document.getElementById(id) as HTMLScriptElement;
      return [id, script.getAttribute("type"), script.hasAttribute("async")];
    }),
  );
  expect(attributes).toEqual([
    ["plain", null, false],
    ["async", null, true],
    ["inline", null, false],
    ["module", "module", false],
    ["async-module", "module", true],
  ]);
});
