import type { Locator, Page } from "@playwright/test";
import { expect, expectNoAxeViolations, test } from "./fixtures";

const NON_BLOCKING = "http://127.0.0.1:47822";

const banner = (page: Page) => page.getByRole("dialog", { name: "Cookies on this demo" });
const settings = (page: Page) => page.getByRole("dialog", { name: "Cookie settings" });
const button = (scope: Locator, name: string) => scope.getByRole("button", { name, exact: true });

async function consentCookie(page: Page): Promise<unknown> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "consent");
  return cookie && JSON.parse(decodeURIComponent(cookie.value));
}

async function records(page: Page): Promise<string[]> {
  return page
    .locator("#records li")
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.action ?? ""));
}

/** The focused element's visible name: its text, or its label for a form control. */
function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | null;
    return (el?.labels?.[0] ?? el)?.textContent?.trim() ?? "";
  });
}
/** Presses Tab until the focused element has `name` as its accessible text. */
async function tabTo(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    if ((await focusedText(page)) === name) return;
  }
  throw new Error(`could not reach "${name}" with Tab`);
}

const ran = (page: Page) =>
  page.evaluate(() => (window as Window & { demoRan?: string[] }).demoRan ?? []);
/** Consent Mode commands pushed so far, as plain arrays. */
const consentCommands = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [])
      .map((entry) => Array.from(entry))
      .filter((entry) => entry[0] === "consent"),
  );

const focusInsideConsent = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest(".consent") !== null);

test.describe("before a choice", () => {
  test("nothing is stored and nothing but the page's own assets is requested", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await page.context().cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    for (const url of requests) {
      expect(new URL(url).origin).toBe("http://127.0.0.1:47821");
      expect(url).toMatch(/\/$|\.(js|css)$/);
    }
    expect(requests.filter((url) => /\/demo\/(analytics|marketing)\.js$/.test(url))).toEqual([]);
    expect(await records(page)).toEqual([]);
  });

  test("the banner is a modal dialog with Accept all and Reject all side by side", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(banner(page)).toHaveAttribute("aria-modal", "true");
    const accept = button(banner(page), "Accept all");
    const reject = button(banner(page), "Reject all");
    const [a, r] = [await accept.boundingBox(), await reject.boundingBox()];
    expect(a && r && Math.abs(a.height - r.height)).toBeLessThan(1);
    expect(a && r && Math.abs(a.y - r.y)).toBeLessThan(1);
    await expect(page.locator("main")).toHaveAttribute("inert", "");
  });
});

test.describe("keyboard only", () => {
  test("reject from the first layer", async ({ page }) => {
    await page.goto("/");
    await expect(banner(page)).toBeFocused();
    await tabTo(page, "Reject all");
    await page.keyboard.press("Enter");
    await expect(banner(page)).toBeHidden();
    expect(await consentCookie(page)).toMatchObject({
      v: 1,
      p: "2026-10",
      c: { necessary: true, analytics: false, marketing: false },
    });
    expect(await records(page)).toEqual(["reject_all"]);
  });

  test("accept from the first layer", async ({ page }) => {
    await page.goto("/");
    await tabTo(page, "Accept all");
    await page.keyboard.press("Enter");
    expect(await consentCookie(page)).toMatchObject({
      c: { necessary: true, analytics: true, marketing: true },
    });
    expect(await records(page)).toEqual(["accept_all"]);
  });

  test("settings, toggle, save, then reopen from the footer", async ({ page }) => {
    await page.goto("/");
    await tabTo(page, "Settings");
    await page.keyboard.press("Enter");
    await expect(settings(page)).toBeFocused();
    await tabTo(page, "Analytics");
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox", { name: "Analytics" })).toBeChecked();
    await tabTo(page, "Save choices");
    await page.keyboard.press("Enter");
    await expect(settings(page)).toBeHidden();
    expect(await consentCookie(page)).toMatchObject({
      c: { necessary: true, analytics: true, marketing: false },
    });
    expect(await records(page)).toEqual(["custom"]);

    await tabTo(page, "Cookie settings");
    await page.keyboard.press("Enter");
    await expect(settings(page)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Analytics" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Necessary" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(settings(page)).toBeHidden();
    expect(await focusedText(page)).toBe("Cookie settings");
  });
});

test.describe("blocking mode", () => {
  test("Tab and Shift+Tab stay inside the banner", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideConsent(page)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInsideConsent(page)).toBe(true);
    }
  });

  test("Escape and backdrop clicks do nothing", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(banner(page)).toBeVisible();
    expect(await page.context().cookies()).toEqual([]);
    expect(
      await page.evaluate(() => document.querySelector(".consent__banner .consent__button--close")),
    ).toBeNull();
  });

  test("Escape closes the settings dialog and returns focus to Settings", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Settings").click();
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings(page)).toBeHidden();
    await expect(button(banner(page), "Settings")).toBeFocused();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideConsent(page)).toBe(true);
    }
  });

  test("the page is usable again after a choice", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Reject all").click();
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    await page.getByRole("link", { name: "Cookie policy", exact: true }).click();
    await expect(page).toHaveURL(/\/cookies\/$/);
    await expect(banner(page)).toBeHidden();
  });
});

test.describe("a page the banner links to (decision #70)", () => {
  /** Two animation frames: the spacer is sized by a ResizeObserver, which reports in the next one. */
  const frames = (page: Page) =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );

  /**
   * Waits until the page stops growing: the demo mirrors the scripts that ran and the dataLayer into
   * the page every 100 ms, so its height changes for a while after load.
   */
  async function settled(page: Page): Promise<void> {
    await expect(page.locator("#ran li")).not.toHaveCount(0);
    let last = -1;
    let stable = 0;
    await expect
      .poll(
        async () => {
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          stable = height === last ? stable + 1 : 0;
          last = height;
          return stable;
        },
        { intervals: [150] },
      )
      .toBeGreaterThanOrEqual(3);
    await frames(page);
  }

  /** The banner's box and the viewport, scrolled to the end and measured in one step. */
  async function geometry(page: Page) {
    await settled(page);
    return page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const banner = document.querySelector(".consent__banner")!.getBoundingClientRect();
      const content = [...document.body.children].filter(
        (el) => !el.classList.contains("consent") && el.getAttribute("aria-hidden") !== "true",
      );
      const contentBottom = Math.max(...content.map((el) => el.getBoundingClientRect().bottom));
      return {
        left: banner.left,
        right: window.innerWidth - banner.right,
        bottom: window.innerHeight - banner.bottom,
        width: window.innerWidth,
        contentBottom,
        bannerTop: banner.top,
      };
    });
  }

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 375, height: 667 },
  ]) {
    test(`the policy is readable: no backdrop, nothing inert, docked 1rem from the bottom (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/cookies/");
      await expect(banner(page)).toBeVisible();
      await expect(page.locator(".consent__backdrop")).toHaveCount(0);
      await expect(page.locator("body > [inert]")).toHaveCount(0);
      await expect(banner(page)).not.toHaveAttribute("aria-modal", "true");
      const g = await geometry(page);
      expect(g.bottom).toBeCloseTo(16, 0);
      // bottom-center: centred, and on a narrow screen the side margins equal the bottom one.
      expect(Math.abs(g.left - g.right)).toBeLessThan(2);
      if (viewport.width < 480) expect(g.left).toBeCloseTo(16, 0);
      // The end of the page is above the banner, not behind it.
      expect(g.contentBottom).toBeLessThanOrEqual(g.bannerTop + 1);
      // The page itself is usable: its links can be followed.
      await expect(page.getByRole("link", { name: "Consent demo" }).first()).toBeEnabled();
      await expectNoAxeViolations(page);
    });
  }

  test("a choice there closes the banner and removes the spacer", async ({ page }) => {
    await page.goto("/cookies/");
    await settled(page);
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    await button(banner(page), "Reject all").click();
    await expect(banner(page)).toBeHidden();
    expect(await consentCookie(page)).toMatchObject({ c: { analytics: false, marketing: false } });
    await expect(page.locator('body > [aria-hidden="true"]:not(.consent)')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      before,
    );
  });

  test("opening and closing the settings dialog there does not move the page", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/cookies/");
    const state = () =>
      page.evaluate(() => {
        const spacer = document.body.lastElementChild as HTMLElement;
        return {
          scrollY: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          spacer: spacer.getBoundingClientRect().height,
        };
      });
    await settled(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await frames(page);
    const before = await state();
    const bannerHeight = (await banner(page).boundingBox())!.height;
    expect(before.spacer).toBeCloseTo(bannerHeight + 16, 0);
    expect(before.scrollY).toBeGreaterThan(0);

    await button(banner(page), "Settings").click();
    await expect(settings(page)).toBeVisible();
    await frames(page);
    expect(await state()).toEqual(before);

    await page.keyboard.press("Escape");
    await expect(banner(page)).toBeVisible();
    await frames(page);
    expect(await state()).toEqual(before);
  });

  test("Escape does not dismiss it, and the settings dialog stays centred in the viewport", async ({
    page,
  }) => {
    await page.goto("/cookies/");
    await page.keyboard.press("Escape");
    await expect(banner(page)).toBeVisible();
    await button(banner(page), "Settings").click();
    await expect(settings(page)).toBeVisible();
    const box = (await settings(page).boundingBox())!;
    const size = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - size.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - size.height / 2)).toBeLessThan(2);
  });

  test("other pages still block", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".consent__backdrop")).toHaveCount(1);
    await expect(page.locator("body > [inert]").first()).toBeAttached();
  });
});

test.describe("non-blocking mode", () => {
  test("close stores nothing and the banner returns on the next page", async ({ page }) => {
    await page.goto(`${NON_BLOCKING}/`);
    await expect(banner(page)).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    await button(banner(page), "Close").click();
    await expect(banner(page)).toBeHidden();
    expect(await page.context().cookies()).toEqual([]);
    expect(await records(page)).toEqual([]);
    await page.getByRole("link", { name: "Cookie policy", exact: true }).click();
    await expect(page).toHaveURL(/\/cookies\/$/);
    await expect(banner(page)).toBeVisible();
  });

  test("the page stays usable while the banner is open", async ({ page }) => {
    await page.goto(`${NON_BLOCKING}/`);
    await page.getByRole("link", { name: "Cookie policy", exact: true }).click();
    await expect(page).toHaveURL(/\/cookies\/$/);
  });

  test("axe finds no violations", async ({ page }) => {
    await page.goto(`${NON_BLOCKING}/`);
    await expect(banner(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe("stored choices", () => {
  test("each kind of choice is stored and recorded with its action", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Accept all").click();
    expect(await consentCookie(page)).toMatchObject({
      c: { necessary: true, analytics: true, marketing: true },
    });

    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("checkbox", { name: "Marketing" }).uncheck();
    await button(settings(page), "Save choices").click();
    expect(await consentCookie(page)).toMatchObject({
      c: { necessary: true, analytics: true, marketing: false },
    });

    await page.getByRole("button", { name: "Withdraw consent" }).click();
    expect(await consentCookie(page)).toMatchObject({
      c: { necessary: true, analytics: false, marketing: false },
    });

    // Nothing granted any more: a second withdraw is a no-op that writes and records nothing.
    const before = (await page.context().cookies()).find((c) => c.name === "consent")!.value;
    await page.getByRole("button", { name: "Withdraw consent" }).click();
    expect((await page.context().cookies()).find((c) => c.name === "consent")!.value).toBe(before);
    expect(await records(page)).toEqual(["accept_all", "custom", "withdraw"]);
  });

  test("a valid choice hides the banner on the next visit", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Reject all").click();
    await page.reload();
    await expect(page.locator(".consent")).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-consent-analytics", "denied");
    await expect(page.locator("html")).toHaveAttribute("data-consent-necessary", "granted");
  });

  test("a policyVersion bump re-prompts", async ({ page, context }) => {
    const old = {
      v: 1,
      p: "2026-01",
      t: 1_760_000_000,
      c: { necessary: true, analytics: true, marketing: true },
    };
    await context.addCookies([
      {
        name: "consent",
        value: encodeURIComponent(JSON.stringify(old)),
        url: "http://127.0.0.1:47821/",
      },
    ]);
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-consent-analytics", "denied");
  });
});

test.describe("locales", () => {
  test("<html lang> selects the strings and {link:<id>} renders as a link", async ({ page }) => {
    await page.goto("/sv/");
    const svBanner = page.getByRole("dialog", { name: "Kakor på den här demon" });
    await expect(svBanner).toBeVisible();
    await expect(button(svBanner, "Godkänn alla")).toBeVisible();
    await expect(button(svBanner, "Avvisa alla")).toBeVisible();
    await expect(svBanner.getByRole("link", { name: "kakpolicyn" })).toHaveAttribute(
      "href",
      "/sv/kakor/",
    );

    await page.goto("/");
    await expect(banner(page).getByRole("link", { name: "cookie policy" })).toHaveAttribute(
      "href",
      "/cookies/",
    );
  });

  test("the language switch changes every string", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Reject all").click();
    await page.getByRole("link", { name: "På svenska" }).click();
    await expect(page).toHaveURL(/\/sv\/$/);
    await page.getByRole("button", { name: "Kakinställningar" }).click();
    const dialog = page.getByRole("dialog", { name: "Kakinställningar" });
    await expect(dialog).toBeVisible();
    const texts = await dialog.locator("button, label, h2").allTextContents();
    expect(texts).toEqual([
      "Kakinställningar",
      "Nödvändiga",
      "Statistik",
      "Marknadsföring",
      "Godkänn alla",
      "Avvisa alla",
      "Spara val",
      "Stäng",
    ]);
  });
});

test.describe("reduced motion", () => {
  test("no animation when prefers-reduced-motion is reduce", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await banner(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await button(banner(page), "Settings").click();
    const toggle = page.getByRole("checkbox", { name: "Analytics" });
    expect(await toggle.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
    expect(await toggle.evaluate((el) => getComputedStyle(el, "::before").transitionDuration)).toBe(
      "0s",
    );
  });
  test("the entry animation runs otherwise", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    expect(await banner(page).evaluate((el) => getComputedStyle(el).animationName)).toBe(
      "consent-in",
    );
  });
});

test.describe("axe", () => {
  test("fresh banner", async ({ page }) => {
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
  test("settings dialog open", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Settings").click();
    await expect(settings(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
  test("after reject (the whole page, no longer inert)", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Reject all").click();
    await expect(banner(page)).toBeHidden();
    await expectNoAxeViolations(page);
  });
  test("after accept (the whole page, no longer inert)", async ({ page }) => {
    await page.goto("/sv/");
    await page.getByRole("button", { name: "Godkänn alla" }).click();
    await expectNoAxeViolations(page);
  });
});

test.describe("adapters", () => {
  test("before a choice only the required gated script runs and Consent Mode defaults are set", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await expect.poll(() => ran(page)).toEqual(["necessary"]);
    await page.waitForLoadState("networkidle");
    expect(requests).toContain("/demo/necessary.js");
    expect(requests).not.toContain("/demo/analytics.js");
    expect(requests).not.toContain("/demo/marketing.js");
    expect(await consentCommands(page)).toEqual([
      [
        "consent",
        "default",
        {
          security_storage: "granted",
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
          functionality_storage: "granted",
        },
      ],
    ]);
    await expect(page.locator("#datalayer li")).toHaveCount(1);
  });

  test("accept runs every gated script once and pushes a granted update", async ({ page }) => {
    await page.goto("/");
    await button(banner(page), "Accept all").click();
    await expect.poll(() => ran(page)).toEqual(["necessary", "analytics", "marketing"]);
    expect((await consentCommands(page)).slice(1)).toEqual([
      [
        "consent",
        "update",
        {
          security_storage: "granted",
          analytics_storage: "granted",
          ad_storage: "granted",
          ad_user_data: "granted",
          ad_personalization: "granted",
        },
      ],
    ]);
    // Withdrawing denies again in Consent Mode; scripts that ran are not run twice.
    await page.getByRole("button", { name: "Withdraw consent" }).click();
    await page.getByRole("button", { name: "Cookie settings" }).click();
    await button(settings(page), "Accept all").click();
    await expect.poll(async () => (await consentCommands(page)).length).toBe(4);
    expect(await ran(page)).toEqual(["necessary", "analytics", "marketing"]);
  });

  test("reject runs no optional script and pushes no update", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.goto("/");
    await button(banner(page), "Reject all").click();
    await page.waitForTimeout(300);
    expect(await ran(page)).toEqual(["necessary"]);
    expect(requests.filter((path) => path.startsWith("/demo/"))).toEqual(["/demo/necessary.js"]);
    expect(await consentCommands(page)).toHaveLength(1);
  });

  test("a returning visitor's stored grant runs its scripts and updates Consent Mode at load", async ({
    page,
  }) => {
    await page.goto("/");
    await button(banner(page), "Settings").click();
    await page.getByRole("checkbox", { name: "Analytics" }).check();
    await button(settings(page), "Save choices").click();
    await page.reload();
    await expect.poll(() => ran(page)).toEqual(["necessary", "analytics"]);
    const commands = await consentCommands(page);
    expect(commands.map((c) => c[1])).toEqual(["default", "update"]);
    expect(commands[1]![2]).toMatchObject({ analytics_storage: "granted", ad_storage: "denied" });
  });
});
