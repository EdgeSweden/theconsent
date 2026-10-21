import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The demo built with Astro's ClientRouter (DEMO_VARIANT=router): navigation swaps <body> without
 * reloading, and bundled modules do not run again (plan: Astro integration, Runtime behaviour).
 */
const ROUTER = "http://127.0.0.1:47823";

const banner = (page: Page) => page.getByRole("dialog", { name: "Cookies on this demo" });
const settings = (page: Page) => page.getByRole("dialog", { name: "Cookie settings" });
const button = (scope: Page | Locator, name: string) =>
  scope.getByRole("button", { name, exact: true });
const ran = (page: Page) =>
  page.evaluate(() => (window as Window & { demoRan?: string[] }).demoRan ?? []);

/** Navigates through a link and proves the router swapped the page instead of reloading it. */
async function navigate(page: Page, link: string, path: RegExp): Promise<void> {
  await page.evaluate(() => ((window as Window & { routerMarker?: boolean }).routerMarker = true));
  await page.getByRole("link", { name: link, exact: true }).click();
  await expect(page).toHaveURL(path);
  await page.waitForFunction(() => document.documentElement.hasAttribute("data-consent-analytics"));
  expect(
    await page.evaluate(() => (window as Window & { routerMarker?: boolean }).routerMarker),
    "client-side navigation",
  ).toBe(true);
}

test("after a client-side navigation the reopen control and the banner still work", async ({
  page,
}) => {
  await page.goto(`${ROUTER}/`);
  await button(banner(page), "Reject all").click();
  await navigate(page, "Cookie policy", /\/cookies\/$/);
  await expect(page.locator(".consent")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-consent-analytics", "denied");

  await button(page, "Cookie settings").click();
  await expect(settings(page)).toBeVisible();
  await page.getByRole("checkbox", { name: "Analytics" }).check();
  await button(settings(page), "Save choices").click();
  await expect(settings(page)).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-consent-analytics", "granted");
  // /cookies/ has its own analytics script ahead of the layout's.
  await expect.poll(() => ran(page)).toEqual(["necessary", "policy page", "analytics"]);
});

test("an accepted script is not loaded again on later pages", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${ROUTER}/`);
  await button(banner(page), "Accept all").click();
  await expect.poll(() => ran(page)).toEqual(["necessary", "analytics", "marketing"]);
  await navigate(page, "Cookie policy", /\/cookies\/$/);
  await navigate(page, "Consent demo", /\/$/);
  await page.waitForTimeout(200);
  expect(await ran(page)).toEqual(["necessary", "analytics", "marketing", "policy page"]);
  expect(requests.filter((path) => path === "/demo/analytics.js")).toHaveLength(1);
});

test("switching language through the router switches the banner's language", async ({ page }) => {
  await page.goto(`${ROUTER}/`);
  await button(banner(page), "Reject all").click();
  await navigate(page, "På svenska", /\/sv\/$/);
  await button(page, "Kakinställningar").click();
  await expect(page.getByRole("dialog", { name: "Kakinställningar" })).toBeVisible();
  await expect(
    button(page.getByRole("dialog", { name: "Kakinställningar" }), "Spara val"),
  ).toBeVisible();
});

test("a granted category's script on a page first reached by navigation runs there", async ({
  page,
}) => {
  await page.goto(`${ROUTER}/cookies/`);
  await button(banner(page), "Reject all").click();
  await navigate(page, "Consent demo", /\/$/);
  expect(await ran(page)).toEqual(["necessary"]);
  await button(page, "Cookie settings").click();
  await button(settings(page), "Accept all").click();
  await expect.poll(() => ran(page)).toEqual(["necessary", "analytics", "marketing"]);
});

test("a gated script that exists only on the page reached by navigation runs exactly once", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${ROUTER}/`);
  await button(banner(page), "Accept all").click();
  await navigate(page, "Cookie policy", /\/cookies\/$/);
  await expect.poll(() => ran(page)).toContain("policy page");
  await page.waitForTimeout(300);
  expect((await ran(page)).filter((entry) => entry === "policy page")).toHaveLength(1);
  expect(requests.filter((path) => path === "/demo/policy-page.js")).toHaveLength(1);
});
