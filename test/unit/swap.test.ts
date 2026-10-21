import { describe, expect, test } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { baseConfig } from "./fixtures";
import { ALL_DENIED, ALL_GRANTED, harness, storedCookie } from "./helpers";

/**
 * Astro's ClientRouter (plan: Astro integration): on navigation it replaces <body>, replaces the
 * <html> attributes with the new page's, then dispatches `astro:after-swap`. Bundled modules are
 * not re-run, so the package must re-attach itself.
 */
async function routed(
  options: { stored?: Record<string, boolean>; config?: Partial<ConsentConfig> } = {},
) {
  const h = await harness({
    cookie: options.stored ? storedCookie({ c: options.stored }) : undefined,
  });
  const gate = await import("../../src/gate/index");
  const config: ConsentConfig = { ...baseConfig(), gateScripts: true, ...options.config };
  const page = (
    lang: string,
    placeholders: Array<{ category: string; src?: string; text?: string }> = [],
  ) => {
    const body = h.doc.createElement("body");
    const reopen = h.doc.createElement("button");
    reopen.setAttribute("data-consent", "open");
    reopen.textContent = "Cookie settings";
    const main = h.doc.createElement("main");
    body.append(main, reopen);
    for (const p of placeholders) {
      const script = h.doc.createElement("script");
      script.setAttribute("type", "text/plain");
      script.setAttribute("data-consent", p.category);
      if (p.src) script.setAttribute("src", p.src);
      if (p.text) script.text = p.text;
      body.append(script);
    }
    return { body, reopen, main, lang };
  };
  const navigate = (next: ReturnType<typeof page>) => {
    for (const name of h.doc.documentElement.getAttributeNames()) {
      h.doc.documentElement.removeAttribute(name);
    }
    h.doc.documentElement.lang = next.lang;
    h.doc.documentElement.replaceChild(next.body, h.doc.body);
    h.doc.dispatchEvent(new h.window.Event("astro:after-swap") as unknown as Event);
    // The router runs the new page's scripts, then announces the finished page.
    h.doc.dispatchEvent(new h.window.Event("astro:page-load") as unknown as Event);
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const banner = () => h.doc.querySelector<HTMLElement>(".consent__banner")!;
  const settings = () => h.doc.querySelector<HTMLElement>(".consent__settings")!;
  return { ...h, gate, config, page, navigate, flush, banner, settings };
}

describe("Astro ClientRouter swaps", () => {
  test("the UI is re-attached to the new body and the reopen control works", async () => {
    const t = await routed({ stored: ALL_DENIED });
    t.api.mount(t.config, t.doc);
    const next = t.page("en");
    t.navigate(next);
    expect(t.doc.querySelectorAll(".consent")).toHaveLength(1);
    expect(next.body.contains(t.doc.querySelector(".consent"))).toBe(true);
    next.reopen.click();
    expect(t.settings().hidden).toBe(false);
    expect(t.settings().isConnected).toBe(true);
  });

  test("the <html> attributes are re-applied after the swap", async () => {
    const t = await routed({ stored: ALL_GRANTED });
    t.api.mount(t.config, t.doc);
    t.navigate(t.page("en"));
    expect(t.doc.documentElement.getAttribute("data-consent-analytics")).toBe("granted");
    expect(t.doc.documentElement.getAttribute("data-consent-necessary")).toBe("granted");
  });

  test("without a choice the banner is shown again on the new page", async () => {
    const t = await routed({ config: { layout: { blocking: false, backdrop: "none" } } });
    t.api.mount(t.config, t.doc);
    t.banner().querySelector<HTMLButtonElement>(".consent__button--close")!.click();
    t.navigate(t.page("en"));
    expect(t.banner().hidden).toBe(false);
    expect(t.doc.querySelector(".consent")!.hasAttribute("hidden")).toBe(false);
  });

  test("a blocking banner makes the new page inert, and a choice releases it", async () => {
    const t = await routed();
    t.api.mount(t.config, t.doc);
    const next = t.page("en");
    t.navigate(next);
    expect(next.main.hasAttribute("inert")).toBe(true);
    [...t.banner().querySelectorAll("button")].find((b) => b.textContent === "Reject all")!.click();
    expect(next.main.hasAttribute("inert")).toBe(false);
  });

  test("a changed <html lang> rebuilds the UI in that locale; state and records use it", async () => {
    const records: string[] = [];
    const t = await routed({
      stored: ALL_DENIED,
      config: { record: (r) => void records.push(r.locale) },
    });
    t.api.mount(t.config, t.doc);
    t.navigate(t.page("sv"));
    expect(t.banner().querySelector(".consent__title")!.textContent).toBe("Kakor");
    expect(t.api.getConsent()!.locale).toBe("sv");
    t.api.withdraw();
    t.runtime.choose({ analytics: true });
    expect(records).toEqual(["sv"]);
  });

  test("the old UI's focus guard is removed", async () => {
    const t = await routed();
    t.api.mount(t.config, t.doc);
    const next = t.page("en");
    t.navigate(next);
    [...t.banner().querySelectorAll("button")].find((b) => b.textContent === "Accept all")!.click();
    next.reopen.focus();
    expect(t.doc.activeElement).toBe(next.reopen);
  });

  test("granted placeholders on the new page are activated; denied ones stay inert", async () => {
    const t = await routed({ stored: { necessary: true, analytics: true, marketing: false } });
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    const next = t.page("en", [
      { category: "analytics", src: "/stats.js" },
      { category: "marketing", src: "/ads.js" },
    ]);
    t.navigate(next);
    await t.flush();
    const types = [...next.body.querySelectorAll("script")].map((s) => [
      s.getAttribute("src"),
      s.getAttribute("type"),
    ]);
    expect(types).toEqual([
      ["/stats.js", null],
      ["/ads.js", "text/plain"],
    ]);
  });

  test("an external script that already ran is not loaded again; inline code runs per page", async () => {
    const t = await routed({ stored: ALL_GRANTED });
    const first = t.page("en", [
      { category: "analytics", src: "/stats.js" },
      { category: "analytics", text: "1;" },
    ]);
    t.doc.documentElement.replaceChild(first.body, t.doc.body);
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.flush();
    const second = t.page("en", [
      { category: "analytics", src: "/stats.js" },
      { category: "analytics", text: "1;" },
    ]);
    t.navigate(second);
    await t.flush();
    const scripts = [...second.body.querySelectorAll("script")];
    expect(scripts.map((s) => s.getAttribute("type"))).toEqual(["text/plain", null]);
  });

  test("a disposed gate ignores swaps", async () => {
    const t = await routed({ stored: ALL_GRANTED });
    const dispose = t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    dispose();
    const next = t.page("en", [{ category: "analytics", src: "/stats.js" }]);
    t.navigate(next);
    await t.flush();
    expect(next.body.querySelector("script")!.getAttribute("type")).toBe("text/plain");
  });

  test("activated scripts carry data-astro-exec so the router does not run them again", async () => {
    const t = await routed({ stored: ALL_GRANTED });
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    const next = t.page("en", [{ category: "analytics", src: "/stats.js" }]);
    t.navigate(next);
    await t.flush();
    expect(next.body.querySelector("script")!.hasAttribute("data-astro-exec")).toBe(true);
  });

  test("the gate rescans on astro:page-load, not on astro:after-swap", async () => {
    const t = await routed({ stored: ALL_GRANTED });
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    const next = t.page("en", [{ category: "analytics", src: "/stats.js" }]);
    t.doc.documentElement.replaceChild(next.body, t.doc.body);
    t.doc.dispatchEvent(new t.window.Event("astro:after-swap") as unknown as Event);
    await t.flush();
    expect(next.body.querySelector("script")!.getAttribute("type")).toBe("text/plain");
    t.doc.dispatchEvent(new t.window.Event("astro:page-load") as unknown as Event);
    await t.flush();
    expect(next.body.querySelector("script")!.getAttribute("type")).toBeNull();
  });

  test("a URL queued but detached by a swap before its turn still loads on a later page", async () => {
    const t = await routed();
    // A slow script in <head> (which the router keeps) holds the chain; happy-dom would fail it
    // at once, so its load and error events are held until the test releases them.
    const slow = t.doc.createElement("script");
    slow.setAttribute("type", "text/plain");
    slow.setAttribute("data-consent", "analytics");
    slow.setAttribute("src", "/slow.js");
    t.doc.head.append(slow);
    const held = new WeakSet<Event>();
    const createElement = t.doc.createElement.bind(t.doc);
    t.doc.createElement = ((tag: string) => {
      const el = createElement(tag);
      if (tag === "script") {
        const dispatch = el.dispatchEvent.bind(el);
        el.dispatchEvent = (event: Event) =>
          (event.type === "load" || event.type === "error") && !held.has(event)
            ? true
            : dispatch(event);
      }
      return el;
    }) as Document["createElement"];
    const first = t.page("en", [{ category: "analytics", src: "/stats.js" }]);
    t.doc.documentElement.replaceChild(first.body, t.doc.body);
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    t.runtime.choose({ analytics: true });
    await t.flush();
    // /stats.js is queued behind /slow.js; the router swaps the page before its turn.
    const second = t.page("en", [{ category: "analytics", src: "/stats.js" }]);
    t.navigate(second);
    await t.flush();
    const liveSlow = t.doc.head.querySelector('script[src="/slow.js"]:not([type])')!;
    const loaded = new t.window.Event("load") as unknown as Event;
    held.add(loaded);
    liveSlow.dispatchEvent(loaded);
    for (let i = 0; i < 3; i++) await t.flush();
    expect(second.body.querySelector("script")!.getAttribute("type")).toBeNull();
  });
});
