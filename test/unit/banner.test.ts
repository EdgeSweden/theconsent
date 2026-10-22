import { describe, expect, test } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { baseConfig } from "./fixtures";
import { ALL_DENIED, ALL_GRANTED, currentCookie, harness, storedCookie } from "./helpers";

type Layout = NonNullable<ConsentConfig["layout"]>;

async function page(
  options: {
    stored?: Readonly<Record<string, boolean>> | undefined;
    p?: string | undefined;
    layout?: Layout;
    config?: Partial<ConsentConfig>;
  } = {},
) {
  const h = await harness({
    cookie: options.stored
      ? storedCookie({ c: options.stored, ...(options.p ? { p: options.p } : {}) })
      : undefined,
  });
  const main = h.doc.createElement("main");
  const reopen = h.doc.createElement("button");
  reopen.setAttribute("data-consent", "open");
  reopen.textContent = "Cookie settings";
  const preInert = h.doc.createElement("aside");
  preInert.setAttribute("inert", "");
  h.doc.body.append(main, reopen, preInert);
  const actions: string[] = [];
  h.runtime.onCommit((commit) => actions.push(commit.action));
  h.api.mount(
    { ...baseConfig(), ...options.config, ...(options.layout ? { layout: options.layout } : {}) },
    h.doc,
  );
  h.cookieWrites.length = 0;

  const q = <T extends Element = HTMLElement>(selector: string) => h.doc.querySelector<T>(selector);
  const root = q(".consent")!;
  const banner = q(".consent__banner")!;
  const settings = q(".consent__settings")!;
  const buttons = (container: Element) => [
    ...container.querySelectorAll<HTMLButtonElement>(":scope > .consent__actions > button"),
  ];
  const byText = (container: Element, text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text,
    )!;
  const key = (key: string, shiftKey = false) => {
    const target = (h.doc.activeElement ?? h.doc.body) as HTMLElement;
    target.dispatchEvent(
      new h.window.KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    );
  };
  const visible = (el: Element) => !el.hasAttribute("hidden") && !el.closest("[hidden]");
  const switchFor = (id: string) => q<HTMLInputElement>(`#consent-switch-${id}`)!;
  return {
    ...h,
    main,
    reopen,
    preInert,
    actions,
    root,
    banner,
    settings,
    buttons,
    byText,
    key,
    visible,
    switchFor,
  };
}

describe("banner visibility (re-prompt matrix)", () => {
  test.each([
    ["no cookie", undefined, undefined, true],
    ["same version", ALL_GRANTED, undefined, false],
    ["changed policyVersion", ALL_GRANTED, "old", true],
    ["added category", { necessary: true, analytics: true }, undefined, true],
    ["removed category", { ...ALL_GRANTED, social: false }, undefined, true],
  ] as const)("%s → banner shown: %s", async (_name, stored, p, shown) => {
    const t = await page({ stored, p });
    expect(t.visible(t.banner)).toBe(shown);
    expect(t.visible(t.root)).toBe(shown);
  });
  test("unparseable cookie → banner shown", async () => {
    const h = await harness({ cookie: "consent=%7Bx" });
    h.api.mount(baseConfig(), h.doc);
    expect(h.doc.querySelector(".consent")!.hasAttribute("hidden")).toBe(false);
  });
  test("the root is appended to body once, and a second mount adds nothing", async () => {
    const t = await page();
    t.api.mount(baseConfig(), t.doc);
    expect(t.doc.querySelectorAll(".consent")).toHaveLength(1);
  });
});

describe("first layer", () => {
  test("Accept all and Reject all are always present as real buttons, in the default order", async () => {
    const t = await page();
    expect(t.buttons(t.banner).map((b) => [b.type, b.textContent])).toEqual([
      ["button", "Accept all"],
      ["button", "Reject all"],
      ["button", "Settings"],
    ]);
  });
  test("buttons.order is applied", async () => {
    const t = await page({
      config: { buttons: { order: ["settings", "rejectAll", "acceptAll"] } },
    });
    expect(t.buttons(t.banner).map((b) => b.textContent)).toEqual([
      "Settings",
      "Reject all",
      "Accept all",
    ]);
  });
  test("buttons.settings false drops Settings but never Accept all / Reject all", async () => {
    const t = await page({ config: { buttons: { settings: false } } });
    expect(t.buttons(t.banner).map((b) => b.textContent)).toEqual(["Accept all", "Reject all"]);
  });
  test("Accept all and Reject all share the same element type and base class", async () => {
    const t = await page();
    const [accept, reject] = t.buttons(t.banner);
    expect(accept!.className.replace("accept", "X")).toBe(reject!.className.replace("reject", "X"));
  });
  test("Accept all stores, closes and reports accept_all", async () => {
    const t = await page();
    t.byText(t.banner, "Accept all").click();
    expect(t.actions).toEqual(["accept_all"]);
    expect(currentCookie(t.doc)).toMatchObject({ c: ALL_GRANTED });
    expect(t.visible(t.root)).toBe(false);
  });
  test("Reject all stores the refusal, closes and reports reject_all", async () => {
    const t = await page();
    t.byText(t.banner, "Reject all").click();
    expect(t.actions).toEqual(["reject_all"]);
    expect(currentCookie(t.doc)).toMatchObject({ c: ALL_DENIED });
    expect(t.visible(t.root)).toBe(false);
  });
});

describe("blocking mode (default)", () => {
  test("dialog semantics: role, aria-modal, aria-labelledby the title", async () => {
    const t = await page();
    expect(t.banner.getAttribute("role")).toBe("dialog");
    expect(t.banner.getAttribute("aria-modal")).toBe("true");
    const labelledBy = t.banner.getAttribute("aria-labelledby")!;
    expect(t.doc.getElementById(labelledBy)!.textContent).toBe("Cookies");
    expect(t.settings.getAttribute("aria-modal")).toBe("true");
  });
  test("there is no close control on the banner", async () => {
    const t = await page();
    expect(t.banner.querySelector(".consent__button--close")).toBeNull();
  });
  test("Escape does nothing on the banner", async () => {
    const t = await page();
    t.key("Escape");
    expect(t.visible(t.banner)).toBe(true);
    expect(t.cookieWrites).toEqual([]);
  });
  test("backdrop clicks do nothing", async () => {
    const t = await page();
    const backdrop = t.root.querySelector<HTMLElement>(".consent__backdrop")!;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.hasAttribute("tabindex")).toBe(false);
    backdrop.click();
    expect(t.visible(t.banner)).toBe(true);
    expect(t.cookieWrites).toEqual([]);
  });
  test("siblings are inert while open; inert is removed on close; pre-existing inert is kept", async () => {
    const t = await page();
    expect(t.main.hasAttribute("inert")).toBe(true);
    expect(t.reopen.hasAttribute("inert")).toBe(true);
    expect(t.root.hasAttribute("inert")).toBe(false);
    t.byText(t.banner, "Reject all").click();
    expect(t.main.hasAttribute("inert")).toBe(false);
    expect(t.reopen.hasAttribute("inert")).toBe(false);
    expect(t.preInert.hasAttribute("inert")).toBe(true);
  });
  // Mutation observer callbacks run as microtasks.
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  test("content added while open is made inert, and freed on close", async () => {
    const t = await page();
    const late = t.doc.createElement("div");
    t.doc.body.append(late);
    await settle();
    expect(late.hasAttribute("inert")).toBe(true);
    t.byText(t.banner, "Reject all").click();
    expect(late.hasAttribute("inert")).toBe(false);
  });
  test("inert is re-applied when the host removes it while open", async () => {
    const t = await page();
    t.main.removeAttribute("inert");
    await settle();
    expect(t.main.hasAttribute("inert")).toBe(true);
    t.byText(t.banner, "Reject all").click();
    expect(t.main.hasAttribute("inert")).toBe(false);
  });
  test("the page is freed when the host removes the root", async () => {
    const t = await page();
    t.root.remove();
    await settle();
    expect(t.main.hasAttribute("inert")).toBe(false);
    expect(t.reopen.hasAttribute("inert")).toBe(false);
    expect(t.preInert.hasAttribute("inert")).toBe(true);
    const late = t.doc.createElement("div");
    t.doc.body.append(late);
    await settle();
    expect(late.hasAttribute("inert")).toBe(false);
  });
  test("a body child that wraps the root is never made inert", async () => {
    const t = await page();
    const wrapper = t.doc.createElement("div");
    t.doc.body.append(wrapper);
    wrapper.append(t.root);
    await settle();
    expect(wrapper.hasAttribute("inert")).toBe(false);
    expect(t.main.hasAttribute("inert")).toBe(true);
  });
  test("content added after close is not made inert", async () => {
    const t = await page();
    t.byText(t.banner, "Reject all").click();
    const late = t.doc.createElement("div");
    t.doc.body.append(late);
    await settle();
    expect(late.hasAttribute("inert")).toBe(false);
  });
  test("focus moves to the dialog on open", async () => {
    const t = await page();
    expect(t.doc.activeElement).toBe(t.banner);
  });
  test("Tab cycles inside the dialog", async () => {
    const t = await page();
    const [first, , last] = t.buttons(t.banner);
    const link = t.banner.querySelector("a");
    const focusable = [link, ...t.buttons(t.banner)].filter(Boolean) as HTMLElement[];
    focusable.at(-1)!.focus();
    t.key("Tab");
    expect(t.doc.activeElement).toBe(focusable[0]);
    t.key("Tab", true);
    expect(t.doc.activeElement).toBe(focusable.at(-1));
    expect(first).toBeDefined();
    expect(last).toBeDefined();
  });
  test("Shift+Tab from the dialog itself goes to the last control", async () => {
    const t = await page();
    t.key("Tab", true);
    expect(t.doc.activeElement).toBe(t.buttons(t.banner).at(-1));
  });
  test("focus that lands outside the dialog is pulled back", async () => {
    const t = await page();
    const outside = t.doc.createElement("button");
    t.doc.body.prepend(outside);
    outside.focus();
    expect(t.root.contains(t.doc.activeElement)).toBe(true);
  });
});

describe("non-blocking mode", () => {
  const layout: Layout = { blocking: false, backdrop: "none" };
  test("no aria-modal, no inert, a close control with visible text", async () => {
    const t = await page({ layout });
    expect(t.banner.hasAttribute("aria-modal")).toBe(false);
    expect(t.main.hasAttribute("inert")).toBe(false);
    expect(t.root.querySelector(".consent__backdrop")).toBeNull();
    expect(t.banner.querySelector(".consent__button--close")!.textContent).toBe("Close");
  });
  test("close means decide later: nothing stored, nothing recorded, state unchanged", async () => {
    const t = await page({ layout });
    t.byText(t.banner, "Close").click();
    expect(t.visible(t.root)).toBe(false);
    expect(t.cookieWrites).toEqual([]);
    expect(t.actions).toEqual([]);
    expect(t.api.getConsent()!.categories).toEqual(ALL_DENIED);
  });
  test("the banner returns on the next page after close", async () => {
    const t = await page({ layout });
    t.byText(t.banner, "Close").click();
    const next = await harness({ cookie: t.doc.cookie || undefined });
    next.api.mount({ ...baseConfig(), layout }, next.doc);
    expect(next.doc.querySelector(".consent")!.hasAttribute("hidden")).toBe(false);
  });
  test("Escape on the banner means decide later", async () => {
    const t = await page({ layout });
    t.key("Escape");
    expect(t.visible(t.root)).toBe(false);
    expect(t.cookieWrites).toEqual([]);
  });
  test("a dimmed non-blocking backdrop does not dismiss on click", async () => {
    const t = await page({ layout: { blocking: false, backdrop: "dim" } });
    t.root.querySelector<HTMLElement>(".consent__backdrop")!.click();
    expect(t.visible(t.banner)).toBe(true);
    expect(t.main.hasAttribute("inert")).toBe(false);
  });
});

describe("settings dialog", () => {
  test("one switch per category; required ones are locked on and labelled always active", async () => {
    const t = await page();
    t.byText(t.banner, "Settings").click();
    expect(t.visible(t.settings)).toBe(true);
    expect(t.visible(t.banner)).toBe(false);
    const necessary = t.switchFor("necessary");
    expect([necessary.type, necessary.checked, necessary.disabled]).toEqual([
      "checkbox",
      true,
      true,
    ]);
    expect(necessary.closest("li")!.textContent).toContain("Always active");
    expect(necessary.getAttribute("role")).toBeNull();
    for (const id of ["analytics", "marketing"]) {
      expect([t.switchFor(id).checked, t.switchFor(id).disabled]).toEqual([false, false]);
      expect(t.doc.querySelector(`label[for="consent-switch-${id}"]`)).not.toBeNull();
    }
  });
  test("services and their cookies are listed under their category", async () => {
    const t = await page();
    const item = t.switchFor("analytics").closest("li")!;
    expect(item.querySelector(".consent__services")!.textContent).toContain("Stats");
    expect(item.querySelector(".consent__cookies")!.textContent).toBe("_stats");
  });
  test("first-visit Save with untouched switches → reject_all", async () => {
    const t = await page();
    t.byText(t.banner, "Settings").click();
    t.byText(t.settings, "Save").click();
    expect(t.actions).toEqual(["reject_all"]);
    expect(currentCookie(t.doc)).toMatchObject({ c: ALL_DENIED });
    expect(t.visible(t.root)).toBe(false);
  });
  test("Save stores the switch states → custom", async () => {
    const t = await page();
    t.byText(t.banner, "Settings").click();
    t.switchFor("analytics").click();
    t.byText(t.settings, "Save").click();
    expect(t.actions).toEqual(["custom"]);
    expect(currentCookie(t.doc)).toMatchObject({
      c: { necessary: true, analytics: true, marketing: false },
    });
  });
  test("the dialog offers Accept all and Reject all too", async () => {
    const t = await page();
    t.byText(t.banner, "Settings").click();
    expect(t.buttons(t.settings).map((b) => b.textContent)).toEqual([
      "Accept all",
      "Reject all",
      "Save",
    ]);
    t.byText(t.settings, "Accept all").click();
    expect(t.actions).toEqual(["accept_all"]);
  });
  test("Escape returns to the banner when it was the opener, focusing Settings", async () => {
    const t = await page();
    t.byText(t.banner, "Settings").click();
    expect(t.doc.activeElement).toBe(t.settings);
    t.key("Escape");
    expect(t.visible(t.banner)).toBe(true);
    expect(t.visible(t.settings)).toBe(false);
    expect(t.doc.activeElement).toBe(t.byText(t.banner, "Settings"));
    expect(t.cookieWrites).toEqual([]);
  });
  test("the close control behaves like Escape", async () => {
    const t = await page();
    t.byText(t.banner, "Settings").click();
    t.byText(t.settings, "Close").click();
    expect(t.visible(t.banner)).toBe(true);
    expect(t.cookieWrites).toEqual([]);
  });
  test('reopen via data-consent="open" shows stored switches; Escape closes and returns focus', async () => {
    const t = await page({ stored: { necessary: true, analytics: true, marketing: false } });
    expect(t.visible(t.root)).toBe(false);
    t.reopen.focus();
    t.reopen.click();
    expect(t.visible(t.settings)).toBe(true);
    expect(t.switchFor("analytics").checked).toBe(true);
    expect(t.switchFor("marketing").checked).toBe(false);
    expect(t.main.hasAttribute("inert")).toBe(true);
    t.key("Escape");
    expect(t.visible(t.root)).toBe(false);
    expect(t.main.hasAttribute("inert")).toBe(false);
    expect(t.doc.activeElement).toBe(t.reopen);
  });
  test("reopen → all off → Save = withdraw, and focus returns to the opener", async () => {
    const t = await page({ stored: ALL_GRANTED });
    t.reopen.click();
    t.switchFor("analytics").click();
    t.switchFor("marketing").click();
    t.byText(t.settings, "Save").click();
    expect(t.actions).toEqual(["withdraw"]);
    expect(t.doc.activeElement).toBe(t.reopen);
  });
  test("reopen → Save untouched is a no-op that only closes", async () => {
    const t = await page({ stored: ALL_GRANTED });
    t.reopen.click();
    t.byText(t.settings, "Save").click();
    expect(t.actions).toEqual([]);
    expect(t.cookieWrites).toEqual([]);
    expect(t.visible(t.root)).toBe(false);
  });
  test("a nested element inside the reopen control works through delegation", async () => {
    const t = await page({ stored: ALL_GRANTED });
    const span = t.doc.createElement("span");
    t.reopen.append(span);
    span.click();
    expect(t.visible(t.settings)).toBe(true);
  });
  test("openSettings() opens the dialog; switches discard unsaved edits on reopen", async () => {
    const t = await page({ stored: ALL_DENIED });
    t.api.openSettings();
    t.switchFor("analytics").click();
    t.key("Escape");
    t.api.openSettings();
    expect(t.switchFor("analytics").checked).toBe(false);
  });
  test("withdraw() while the settings dialog is open closes it", async () => {
    const t = await page({ stored: ALL_GRANTED });
    t.api.openSettings();
    t.api.withdraw();
    expect(t.visible(t.root)).toBe(false);
    expect(t.actions).toEqual(["withdraw"]);
  });
});

describe("labels and positions", () => {
  test("an empty title uses dialogLabel as aria-label", async () => {
    const config = baseConfig();
    config.locales.en!.title = "";
    config.locales.en!.dialogLabel = "Cookie consent";
    const t = await page({ config });
    expect(t.banner.getAttribute("aria-label")).toBe("Cookie consent");
    expect(t.banner.hasAttribute("aria-labelledby")).toBe(false);
  });
  test("aria-describedby points at the description", async () => {
    const t = await page();
    expect(t.doc.getElementById(t.banner.getAttribute("aria-describedby")!)!.textContent).toContain(
      "We use cookies",
    );
  });
  test.each([
    "bottom-left",
    "bottom-right",
    "bottom-center",
    "top-left",
    "top-right",
    "top-center",
    "center",
  ] as const)("position %s is exposed for the stylesheet", async (position) => {
    const t = await page({ layout: { position } });
    expect(t.root.getAttribute("data-position")).toBe(position);
  });
  test("the default position is bottom-center", async () => {
    const t = await page();
    expect(t.root.getAttribute("data-position")).toBe("bottom-center");
  });
  test("strings come from the resolved locale", async () => {
    const h = await harness({ lang: "sv-SE" });
    h.api.mount(baseConfig(), h.doc);
    expect(h.doc.querySelector(".consent__banner .consent__title")!.textContent).toBe("Kakor");
  });
});

describe("late body", () => {
  test("mount before <body> exists attaches on DOMContentLoaded", async () => {
    const h = await harness();
    h.doc.body.remove();
    h.api.mount(baseConfig(), h.doc);
    expect(h.doc.querySelector(".consent")).toBeNull();
    h.doc.documentElement.append(h.doc.createElement("body"));
    h.doc.dispatchEvent(new h.window.Event("DOMContentLoaded") as unknown as Event);
    expect(h.doc.querySelector(".consent")).not.toBeNull();
  });
});

describe("hardening", () => {
  test("an unvalidated buttons.order cannot drop Accept all or Reject all", async () => {
    const t = await page({ config: { buttons: { order: ["settings"] } } });
    expect(t.buttons(t.banner).map((b) => b.textContent)).toEqual([
      "Settings",
      "Accept all",
      "Reject all",
    ]);
  });
  test("unknown entries in an unvalidated order are ignored", async () => {
    const t = await page({
      config: { buttons: { order: ["acceptAll", "rejectAll", "typo" as never] } },
    });
    expect(t.buttons(t.banner).map((b) => b.textContent)).toEqual(["Accept all", "Reject all"]);
  });
  test("duplicate entries in an unvalidated order render once", async () => {
    const t = await page({
      config: { buttons: { order: ["acceptAll", "acceptAll", "rejectAll"] } },
    });
    expect(t.buttons(t.banner).map((b) => b.textContent)).toEqual(["Accept all", "Reject all"]);
  });
  test("category ids that share a prefix do not produce colliding element ids", async () => {
    const config = baseConfig();
    config.categories.push({ id: "a" }, { id: "a-description" });
    for (const locale of Object.values(config.locales)) {
      locale.categories.a = { name: "A", description: "about a" };
      locale.categories["a-description"] = { name: "A description", description: "about b" };
    }
    const t = await page({ config });
    const ids = [...t.root.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(t.doc.querySelector('label[for="consent-switch-a-description"]')!.textContent).toBe(
      "A description",
    );
  });
  test("the settings dialog is described by settingsDescription when given", async () => {
    const config = baseConfig();
    config.locales.en!.settingsDescription = "Choose.";
    const t = await page({ config });
    const describedBy = t.settings.getAttribute("aria-describedby")!;
    expect(t.doc.getElementById(describedBy)!.textContent).toBe("Choose.");
    const plain = await page();
    expect(plain.settings.hasAttribute("aria-describedby")).toBe(false);
  });
  test("openSettings() before <body> exists does not throw", async () => {
    const h = await harness();
    h.doc.body.remove();
    h.api.mount(baseConfig(), h.doc);
    expect(() => h.api.openSettings()).not.toThrow();
  });
});

describe("ids", () => {
  test("keeps ARIA and label references inside the root when ids collide", async () => {
    const h = await harness();
    for (const id of ["consent-title", "consent-description", "consent-switch-analytics"]) {
      const host = h.doc.createElement("div");
      host.id = id;
      h.doc.body.append(host);
    }
    h.api.mount(baseConfig(), h.doc);
    const root = h.doc.querySelector(".consent")!;
    const refs = [...root.querySelectorAll("[aria-labelledby], [aria-describedby], label[for]")];
    expect(refs.length).toBeGreaterThan(0);
    for (const el of refs) {
      const ids = ["aria-labelledby", "aria-describedby", "for"].flatMap((name) =>
        (el.getAttribute(name) ?? "").split(" ").filter(Boolean),
      );
      for (const id of ids) {
        const target = h.doc.getElementById(id);
        expect(target, id).not.toBeNull();
        expect(root.contains(target), id).toBe(true);
      }
    }
    expect(root.querySelector("#consent1-title")).not.toBeNull();
  });
  test("uses the consent- prefix when nothing collides", async () => {
    const t = await page();
    expect(t.root.querySelector("#consent-title")).not.toBeNull();
  });
});
