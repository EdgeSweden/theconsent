import { describe, expect, test } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { baseConfig } from "./fixtures";
import { ALL_GRANTED, harness, storedCookie } from "./helpers";

/** A page with one gated placeholder per category, the core and the gate from one module graph. */
async function gated(
  options: { stored?: Record<string, boolean>; config?: Partial<ConsentConfig> } = {},
) {
  const h = await harness({
    cookie: options.stored ? storedCookie({ c: options.stored }) : undefined,
  });
  const gate = await import("../../src/gate/index");
  // happy-dom fails every external script load synchronously on insertion. Hold back load and
  // error events that the test did not send, so each test decides when a script "loads".
  const testEvents = new WeakSet<Event>();
  const createElement = h.doc.createElement.bind(h.doc);
  h.doc.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const el = createElement(tag, options);
    if (tag === "script") {
      const dispatch = el.dispatchEvent.bind(el);
      el.dispatchEvent = (event: Event) =>
        (event.type === "load" || event.type === "error") && !testEvents.has(event)
          ? true
          : dispatch(event);
    }
    return el;
  }) as Document["createElement"];
  /** Fires `load` or `error` on a live script as the browser would. */
  const fire = (script: Element, type: "load" | "error") => {
    const event = new h.window.Event(type) as unknown as Event;
    testEvents.add(event);
    script.dispatchEvent(event);
  };
  const placeholder = (category: string, attrs: Record<string, string> = {}, text = "") => {
    const script = h.doc.createElement("script");
    script.setAttribute("type", "text/plain");
    script.setAttribute("data-consent", category);
    for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
    script.text = text;
    h.doc.body.append(script);
    return script;
  };
  const necessary = placeholder("necessary", { src: "/necessary.js" });
  const analytics = placeholder("analytics", {
    src: "/analytics.js",
    async: "",
    "data-id": "stats",
    crossorigin: "anonymous",
  });
  const marketing = placeholder(
    "marketing",
    { "data-type": "module" },
    "window.__ads = (window.__ads ?? 0) + 1;",
  );
  const config = { ...baseConfig(), gateScripts: true, ...options.config };
  /** Lets the activation chain run, firing `load` for each live external script it waits on. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      for (const script of h.doc.querySelectorAll<HTMLScriptElement>(
        "script[src]:not([type='text/plain'])",
      )) {
        if (script.dataset.testLoaded) continue;
        script.dataset.testLoaded = "";
        fire(script, "load");
      }
    }
  };
  const live = (category: string) => [
    ...h.doc.querySelectorAll<HTMLScriptElement>(`script[data-consent="${category}"]`),
  ];
  return { ...h, gate, config, necessary, analytics, marketing, live, settle, placeholder, fire };
}

describe("script gating", () => {
  test("nothing optional is activated before a choice; the required script is activated at mount", async () => {
    const t = await gated();
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    expect(t.necessary.isConnected).toBe(false);
    const [necessary] = t.live("necessary");
    expect(necessary!.getAttribute("type")).toBeNull();
    expect(necessary!.getAttribute("src")).toBe("/necessary.js");
    expect(t.analytics.isConnected).toBe(true);
    expect(t.analytics.getAttribute("type")).toBe("text/plain");
    expect(t.marketing.isConnected).toBe(true);
  });

  test("installing after mount activates for the current state at once", async () => {
    const t = await gated({ stored: { necessary: true, analytics: true, marketing: false } });
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    expect(t.analytics.isConnected).toBe(false);
    expect(t.marketing.isConnected).toBe(true);
  });

  test("a grant replaces the placeholder with a live script, attributes and text preserved", async () => {
    const t = await gated();
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ analytics: true, marketing: true });
    await t.settle();
    const [analytics] = t.live("analytics");
    expect(analytics).not.toBe(t.analytics);
    const attributes = [...analytics!.attributes].filter(
      (a) => a.name !== "data-test-loaded" && a.name !== "data-astro-exec",
    );
    expect(Object.fromEntries(attributes.map((a) => [a.name, a.value]))).toEqual({
      "data-consent": "analytics",
      src: "/analytics.js",
      async: "",
      "data-id": "stats",
      crossorigin: "anonymous",
    });
    const [marketing] = t.live("marketing");
    expect(marketing!.getAttribute("type")).toBe("module");
    expect(marketing!.hasAttribute("data-type")).toBe(false);
    expect(marketing!.text).toBe("window.__ads = (window.__ads ?? 0) + 1;");
  });

  test("each script is activated once, across later changes and repeated grants", async () => {
    const t = await gated();
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ analytics: true });
    await t.settle();
    const [first] = t.live("analytics");
    t.runtime.choose({ analytics: true, marketing: true });
    await t.settle();
    t.api.withdraw();
    await t.settle();
    t.runtime.choose({ analytics: true, marketing: true });
    await t.settle();
    expect(t.live("analytics")).toEqual([first]);
    expect(t.live("necessary")).toHaveLength(1);
  });

  test("a denied script is left untouched", async () => {
    const t = await gated();
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ analytics: true, marketing: false });
    await t.settle();
    expect(t.marketing.isConnected).toBe(true);
    expect(t.marketing.getAttribute("type")).toBe("text/plain");
  });

  test("withdrawing does not touch scripts that already ran", async () => {
    const t = await gated({ stored: ALL_GRANTED });
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    const before = t.live("analytics");
    t.api.withdraw();
    await t.settle();
    expect(t.live("analytics")).toEqual(before);
  });

  test("the nonce is carried over", async () => {
    const t = await gated();
    t.analytics.nonce = "abc123";
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ analytics: true });
    await t.settle();
    expect(t.live("analytics")[0]!.nonce).toBe("abc123");
  });

  test("gateScripts false or absent installs nothing", async () => {
    for (const gateScripts of [false, undefined]) {
      const t = await gated({ stored: ALL_GRANTED, config: { gateScripts } });
      const dispose = t.gate.installScriptGating(t.config, t.doc);
      t.api.mount(t.config, t.doc);
      await t.settle();
      expect(t.analytics.isConnected).toBe(true);
      expect(t.necessary.isConnected).toBe(true);
      expect(() => dispose()).not.toThrow();
    }
  });

  test("the disposer stops further activation", async () => {
    const t = await gated();
    const dispose = t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    dispose();
    t.runtime.choose({ analytics: true, marketing: true });
    await t.settle();
    expect(t.analytics.isConnected).toBe(true);
  });

  test("install is the shared adapter name", async () => {
    const t = await gated();
    expect(t.gate.install).toBe(t.gate.installScriptGating);
  });

  test("only text/plain placeholders are gated", async () => {
    const t = await gated();
    const live = t.doc.createElement("script");
    live.setAttribute("data-consent", "marketing");
    live.setAttribute("src", "/already-live.js");
    t.doc.body.append(live);
    t.gate.installScriptGating(t.config, t.doc);
    await t.settle();
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ marketing: true });
    await t.settle();
    expect(live.isConnected).toBe(true);
  });

  test("activated scripts keep page order: each waits for earlier ordered external scripts", async () => {
    const t = await gated();
    const init = t.placeholder("analytics", {}, "window.__init = true;");
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await Promise.resolve();
    await Promise.resolve();
    // The required external script is live but has not loaded: nothing after it is inserted yet.
    expect(t.live("necessary")[0]!.getAttribute("type")).toBeNull();
    t.runtime.choose({ analytics: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.analytics.isConnected).toBe(true);
    expect(init.isConnected).toBe(true);

    t.fire(t.live("necessary")[0]!, "load");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const analytics = t.live("analytics").find((s) => s.getAttribute("src") === "/analytics.js")!;
    expect(analytics.getAttribute("type")).toBeNull();
    // /analytics.js has the async attribute, so the inline init after it does not wait for it.
    expect(init.isConnected).toBe(false);
  });

  test("an external classic script keeps its async attribute as written", async () => {
    const t = await gated();
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    const necessary = t.live("necessary")[0]!;
    expect(necessary.hasAttribute("async")).toBe(false);
    t.runtime.choose({ analytics: true });
    await t.settle();
    expect(
      t
        .live("analytics")
        .find((s) => s.src.endsWith("/analytics.js"))!
        .hasAttribute("async"),
    ).toBe(true);
  });

  test("inline code after an ordered external script waits for it to load or fail", async () => {
    const t = await gated();
    const library = t.placeholder("marketing", { src: "/lib.js" });
    const init = t.placeholder("marketing", {}, "window.lib.init();");
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ marketing: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(library.isConnected).toBe(false);
    expect(init.isConnected).toBe(true);
    const live = t.live("marketing").find((s) => s.getAttribute("src") === "/lib.js")!;
    t.fire(live, "error");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(init.isConnected).toBe(false);
  });

  test("installed before the body is parsed, it activates on DOMContentLoaded", async () => {
    const t = await gated({ stored: ALL_GRANTED });
    Object.defineProperty(t.doc, "readyState", { configurable: true, value: "loading" });
    const placeholders = [...t.doc.querySelectorAll("script[type='text/plain']")];
    for (const p of placeholders) p.remove();
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    for (const p of placeholders) t.doc.body.append(p);
    Object.defineProperty(t.doc, "readyState", { configurable: true, value: "interactive" });
    t.doc.dispatchEvent(new t.window.Event("DOMContentLoaded") as unknown as Event);
    await t.settle();
    expect(t.necessary.isConnected).toBe(false);
    expect(t.analytics.isConnected).toBe(false);
    expect(t.marketing.isConnected).toBe(false);
  });

  test.each([
    ["nomodule", { src: "/legacy.js", nomodule: "" }],
    ["an unknown data-type", { src: "/data.json", "data-type": "application/json" }],
  ])("a skipped external script (%s) does not hold up later ones", async (_name, attrs) => {
    const t = await gated();
    const skipped = t.placeholder("marketing", attrs as Record<string, string>);
    const init = t.placeholder("marketing", {}, "window.__after = true;");
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ marketing: true });
    // No load or error event is sent for the skipped script.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(skipped.isConnected).toBe(false);
    expect(init.isConnected).toBe(false);
  });

  test("a throwing activation does not stall later ones", async () => {
    const t = await gated();
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    const replaceWith = t.analytics.replaceWith.bind(t.analytics);
    t.analytics.replaceWith = () => {
      t.analytics.replaceWith = replaceWith;
      throw new Error("boom");
    };
    t.runtime.choose({ analytics: true, marketing: true });
    await t.settle();
    expect(t.marketing.isConnected).toBe(false);
  });

  test("at DOMContentLoaded, denied placeholders stay inert", async () => {
    const t = await gated({ stored: { necessary: true, analytics: true, marketing: false } });
    Object.defineProperty(t.doc, "readyState", { configurable: true, value: "loading" });
    const placeholders = [...t.doc.querySelectorAll("script[type='text/plain']")];
    for (const p of placeholders) p.remove();
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    for (const p of placeholders) t.doc.body.append(p);
    t.doc.dispatchEvent(new t.window.Event("DOMContentLoaded") as unknown as Event);
    await t.settle();
    expect(t.analytics.isConnected).toBe(false);
    expect(t.marketing.isConnected).toBe(true);
    expect(t.marketing.getAttribute("type")).toBe("text/plain");
  });

  test("disposed before DOMContentLoaded, nothing is activated", async () => {
    const t = await gated({ stored: ALL_GRANTED });
    Object.defineProperty(t.doc, "readyState", { configurable: true, value: "loading" });
    const placeholders = [...t.doc.querySelectorAll("script[type='text/plain']")];
    for (const p of placeholders) p.remove();
    const dispose = t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    dispose();
    for (const p of placeholders) t.doc.body.append(p);
    t.doc.dispatchEvent(new t.window.Event("DOMContentLoaded") as unknown as Event);
    await t.settle();
    expect(placeholders.every((p) => p.isConnected)).toBe(true);
  });

  test("modules are inserted with async false and never waited for", async () => {
    const t = await gated();
    const module = t.placeholder("marketing", { src: "/mod.js", "data-type": "module" });
    const nomoduleModule = t.placeholder(
      "marketing",
      { "data-type": "module", nomodule: "" },
      "1;",
    );
    const after = t.placeholder("marketing", {}, "window.__after = true;");
    t.gate.installScriptGating(t.config, t.doc);
    t.api.mount(t.config, t.doc);
    await t.settle();
    t.runtime.choose({ marketing: true });
    // No load event is sent for the external module: later scripts are inserted anyway.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect([module, nomoduleModule, after].map((p) => p.isConnected)).toEqual([
      false,
      false,
      false,
    ]);
    const liveModules = t.live("marketing").filter((s) => s.getAttribute("type") === "module");
    // The two above plus the fixture's own inline module placeholder.
    expect(liveModules).toHaveLength(3);
    for (const live of liveModules) expect(live.async).toBe(false);
  });
});
