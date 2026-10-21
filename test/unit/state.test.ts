import { describe, expect, test, vi } from "vitest";
import type { ConsentState } from "../../src/core/types";
import { baseConfig } from "./fixtures";
import { ALL_DENIED, ALL_GRANTED, currentCookie, harness, storedCookie } from "./helpers";

const NOW = 1_770_000_000;

/** Mounts with an optional stored choice and records every committed action. */
async function mounted(stored?: Record<string, boolean>, options: { p?: string | undefined } = {}) {
  const h = await harness({
    cookie: stored
      ? storedCookie({ c: stored, ...(options.p ? { p: options.p } : {}) })
      : undefined,
  });
  const actions: string[] = [];
  h.runtime.onCommit((commit) => actions.push(commit.action));
  h.api.mount(baseConfig(), h.doc);
  h.cookieWrites.length = 0;
  return { ...h, actions };
}

describe("re-prompt matrix", () => {
  test.each([
    ["no cookie", undefined, undefined, false],
    ["same version", { ...ALL_GRANTED }, undefined, true],
    ["changed policyVersion", { ...ALL_GRANTED }, "2026-01", false],
    ["added category", { necessary: true, analytics: true }, undefined, false],
    ["removed category", { ...ALL_GRANTED, social: true }, undefined, false],
  ] as const)("%s → valid choice: %s", async (_name, stored, p, valid) => {
    const h = await mounted(stored, { p });
    const state = h.api.getConsent()!;
    expect(state.at !== null).toBe(valid);
    expect(state.categories).toEqual(valid ? ALL_GRANTED : ALL_DENIED);
  });
  test("unparseable cookie → no valid choice", async () => {
    const h = await harness({ cookie: "consent=%7Bgarbage" });
    h.api.mount(baseConfig(), h.doc);
    expect(h.api.getConsent()).toMatchObject({ at: null, categories: ALL_DENIED });
  });
  test("a stale cookie reports every optional category denied until a new choice", async () => {
    const h = await mounted({ ...ALL_GRANTED }, { p: "old" });
    expect(h.api.getConsent()!.categories).toEqual(ALL_DENIED);
    expect(h.cookieWrites).toEqual([]);
  });
});

describe("action semantics", () => {
  test("first visit: Accept all → accept_all", async () => {
    const h = await mounted();
    h.runtime.choose({ analytics: true, marketing: true });
    expect(h.actions).toEqual(["accept_all"]);
    expect(currentCookie(h.doc)).toMatchObject({ v: 1, p: "2026-10", c: ALL_GRANTED });
  });
  test("first visit: Reject all → reject_all and the refusal is stored", async () => {
    const h = await mounted();
    h.runtime.choose({ analytics: false, marketing: false });
    expect(h.actions).toEqual(["reject_all"]);
    expect(currentCookie(h.doc)).toMatchObject({ c: ALL_DENIED });
  });
  test("first visit: Save with untouched switches → reject_all", async () => {
    const h = await mounted();
    h.runtime.choose({});
    expect(h.actions).toEqual(["reject_all"]);
    expect(h.cookieWrites).toHaveLength(1);
  });
  test("first visit: a mix → custom", async () => {
    const h = await mounted();
    h.runtime.choose({ analytics: true, marketing: false });
    expect(h.actions).toEqual(["custom"]);
  });
  test("accepted → reopen → all switches off → Save = withdraw", async () => {
    const h = await mounted({ ...ALL_GRANTED });
    h.runtime.choose({ analytics: false, marketing: false });
    expect(h.actions).toEqual(["withdraw"]);
    expect(currentCookie(h.doc)).toMatchObject({ c: ALL_DENIED });
  });
  test("custom → all off → withdraw", async () => {
    const h = await mounted({ necessary: true, analytics: true, marketing: false });
    h.runtime.choose({ analytics: false, marketing: false });
    expect(h.actions).toEqual(["withdraw"]);
  });
  test("rejected → accept all → accept_all", async () => {
    const h = await mounted({ ...ALL_DENIED });
    h.runtime.choose({ analytics: true, marketing: true });
    expect(h.actions).toEqual(["accept_all"]);
  });
  test("rejected → mix → custom", async () => {
    const h = await mounted({ ...ALL_DENIED });
    h.runtime.choose({ analytics: true });
    expect(h.actions).toEqual(["custom"]);
  });
  test("accepted → mix → custom", async () => {
    const h = await mounted({ ...ALL_GRANTED });
    h.runtime.choose({ analytics: true, marketing: false });
    expect(h.actions).toEqual(["custom"]);
  });
  test("stale policy with everything granted before: Reject all is reject_all (no valid prior)", async () => {
    const h = await mounted({ ...ALL_GRANTED }, { p: "old" });
    h.runtime.choose({ analytics: false, marketing: false });
    expect(h.actions).toEqual(["reject_all"]);
  });
  test("stale policy: identical choice is still written and recorded (first decision)", async () => {
    const h = await mounted({ ...ALL_GRANTED }, { p: "old" });
    h.runtime.choose({ analytics: true, marketing: true });
    expect(h.actions).toEqual(["accept_all"]);
    expect(currentCookie(h.doc)).toMatchObject({ p: "2026-10" });
  });
  test.each([
    ["accepted", { ...ALL_GRANTED }, { analytics: true, marketing: true }],
    ["rejected", { ...ALL_DENIED }, { analytics: false, marketing: false }],
    ["custom", { necessary: true, analytics: true, marketing: false }, { analytics: true }],
  ])("no-op: %s → identical choice writes and records nothing", async (_name, stored, choice) => {
    const h = await mounted(stored);
    const before = h.doc.cookie;
    const changes = vi.fn();
    h.api.onConsent(changes);
    changes.mockClear();
    h.runtime.choose(choice);
    expect(h.actions).toEqual([]);
    expect(h.cookieWrites).toEqual([]);
    expect(h.doc.cookie).toBe(before);
    expect(changes).not.toHaveBeenCalled();
  });
  test("a second identical choice after a first decision is a no-op", async () => {
    const h = await mounted();
    h.runtime.choose({ analytics: true });
    h.runtime.choose({ analytics: true });
    expect(h.actions).toEqual(["custom"]);
    expect(h.cookieWrites).toHaveLength(1);
  });
  test("the stored timestamp is unix seconds", async () => {
    vi.useFakeTimers({ now: NOW * 1000 + 999 });
    try {
      const h = await mounted();
      h.runtime.choose({ analytics: true, marketing: true });
      expect(currentCookie(h.doc)).toMatchObject({ t: NOW });
      expect(h.api.getConsent()!.at).toBe(NOW);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withdraw()", () => {
  test("with a prior grant → withdraw, every optional category denied", async () => {
    const h = await mounted({ necessary: true, analytics: false, marketing: true });
    h.api.withdraw();
    expect(h.actions).toEqual(["withdraw"]);
    expect(h.api.getConsent()!.categories).toEqual(ALL_DENIED);
  });
  test("nothing granted before, valid stored choice → no-op", async () => {
    const h = await mounted({ ...ALL_DENIED });
    h.api.withdraw();
    expect(h.actions).toEqual([]);
    expect(h.cookieWrites).toEqual([]);
  });
  test("no valid stored choice → reject_all", async () => {
    const h = await mounted();
    h.api.withdraw();
    expect(h.actions).toEqual(["reject_all"]);
    expect(currentCookie(h.doc)).toMatchObject({ c: ALL_DENIED });
  });
  test("before mount → nothing happens", async () => {
    const h = await harness();
    h.api.withdraw();
    expect(h.cookieWrites).toEqual([]);
    expect(h.api.getConsent()).toBeNull();
  });
});

describe("required categories", () => {
  test("granted before any choice", async () => {
    const h = await mounted();
    expect(h.api.getConsent()!.categories.necessary).toBe(true);
    expect(h.doc.documentElement.getAttribute("data-consent-necessary")).toBe("granted");
  });
  test("granted and stored as true after Reject all", async () => {
    const h = await mounted();
    h.runtime.choose({ analytics: false, marketing: false, necessary: false });
    expect(h.api.getConsent()!.categories.necessary).toBe(true);
    expect(currentCookie(h.doc)).toMatchObject({ c: { necessary: true } });
  });
  test("granted after withdraw()", async () => {
    const h = await mounted({ ...ALL_GRANTED });
    h.api.withdraw();
    expect(h.api.getConsent()!.categories.necessary).toBe(true);
    expect(currentCookie(h.doc)).toMatchObject({ c: { necessary: true } });
  });
  test("granted on a stale cookie", async () => {
    const h = await mounted({ ...ALL_DENIED }, { p: "old" });
    expect(h.api.getConsent()!.categories.necessary).toBe(true);
  });
  test("a required category is not part of the action derivation", async () => {
    const h = await mounted();
    h.runtime.choose({ necessary: false, analytics: true, marketing: true });
    expect(h.actions).toEqual(["accept_all"]);
  });
});

describe("nothing optional before a choice", () => {
  test("mount with no cookie writes, stores and sends nothing", async () => {
    const h = await harness();
    const config = { ...baseConfig(), record: "/consent" };
    h.api.mount(config, h.doc);
    h.api.getConsent();
    h.api.onConsent(() => {});
    expect(h.cookieWrites).toEqual([]);
    expect(h.storageAccess).toEqual([]);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.sendBeacon).not.toHaveBeenCalled();
  });
  test("mount with a stale cookie writes nothing", async () => {
    const h = await harness({ cookie: storedCookie({ c: ALL_GRANTED, p: "old" }) });
    h.cookieWrites.length = 0;
    h.api.mount(baseConfig(), h.doc);
    expect(h.cookieWrites).toEqual([]);
  });
});

describe("state API", () => {
  test("getConsent() is null before mount", async () => {
    const h = await harness();
    expect(h.api.getConsent()).toBeNull();
  });
  test("ConsentState shape", async () => {
    const h = await mounted({ ...ALL_GRANTED });
    expect(h.api.getConsent()).toEqual({
      categories: ALL_GRANTED,
      policyVersion: "2026-10",
      locale: "en",
      at: 1_760_000_000,
    });
  });
  test("returned state is a copy", async () => {
    const h = await mounted();
    h.api.getConsent()!.categories.analytics = true;
    expect(h.api.getConsent()!.categories.analytics).toBe(false);
  });
});

describe("callbacks", () => {
  test("a pre-mount subscriber fires once during mount, never from the cookie alone", async () => {
    const h = await harness({ cookie: storedCookie({ c: ALL_GRANTED }) });
    const seen: ConsentState[] = [];
    h.api.onConsent((state) => seen.push(state));
    expect(seen).toEqual([]);
    h.api.mount(baseConfig(), h.doc);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.categories).toEqual(ALL_GRANTED);
  });
  test("a post-mount subscriber fires immediately with the current state", async () => {
    const h = await mounted();
    const listener = vi.fn();
    h.api.onConsent(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ categories: ALL_DENIED, at: null });
  });
  test("each subscriber fires once per change", async () => {
    const pre = vi.fn();
    const h = await harness();
    h.api.onConsent(pre);
    h.api.mount(baseConfig(), h.doc);
    const post = vi.fn();
    h.api.onConsent(post);
    h.runtime.choose({ analytics: true });
    h.runtime.choose({ analytics: true, marketing: true });
    expect(pre).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2]![0].categories).toEqual(ALL_GRANTED);
  });
  test("a second mount does not double-fire and does not block a new subscriber", async () => {
    const h = await harness();
    const first = vi.fn();
    h.api.onConsent(first);
    h.api.mount(baseConfig(), h.doc);
    h.api.mount(baseConfig(), h.doc);
    expect(first).toHaveBeenCalledTimes(1);
    const second = vi.fn();
    h.api.onConsent(second);
    h.api.mount(baseConfig(), h.doc);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
  test("a second mount with another config is ignored", async () => {
    const h = await harness();
    h.api.mount(baseConfig(), h.doc);
    h.api.mount({ ...baseConfig(), policyVersion: "other" }, h.doc);
    expect(h.api.getConsent()!.policyVersion).toBe("2026-10");
  });
  test("subscribing the same function twice is two independent subscriptions", async () => {
    const h = await mounted();
    const listener = vi.fn();
    const first = h.api.onConsent(listener);
    h.api.onConsent(listener);
    expect(listener).toHaveBeenCalledTimes(2);
    h.runtime.choose({ analytics: true });
    expect(listener).toHaveBeenCalledTimes(4);
    first();
    h.runtime.choose({ analytics: true, marketing: true });
    expect(listener).toHaveBeenCalledTimes(5);
  });
  test("unsubscribe stops further calls", async () => {
    const h = await mounted();
    const listener = vi.fn();
    const unsubscribe = h.api.onConsent(listener);
    unsubscribe();
    h.runtime.choose({ analytics: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });
  test("a throwing subscriber does not stop others or the commit", async () => {
    const h = await mounted();
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    process.on("uncaughtException", onError);
    try {
      h.api.onConsent(() => {
        throw new Error("boom");
      });
      const other = vi.fn();
      h.api.onConsent(other);
      h.runtime.choose({ analytics: true });
      expect(other).toHaveBeenCalledTimes(2);
      expect(h.actions).toEqual(["custom"]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("uncaughtException", onError);
    }
    expect(errors).toHaveLength(2);
  });
});

describe("DOM mirror", () => {
  test("data-consent-<id> attributes on <html> at mount and on change", async () => {
    const h = await mounted();
    const attrs = () =>
      ["necessary", "analytics", "marketing"].map((id) =>
        h.doc.documentElement.getAttribute(`data-consent-${id}`),
      );
    expect(attrs()).toEqual(["granted", "denied", "denied"]);
    h.runtime.choose({ marketing: true });
    expect(attrs()).toEqual(["granted", "denied", "granted"]);
  });
  test("consent:change fires on document at mount and on each change, with the state", async () => {
    const h = await harness();
    const events: ConsentState[] = [];
    h.doc.addEventListener("consent:change", (event) =>
      events.push((event as CustomEvent<ConsentState>).detail),
    );
    h.api.mount(baseConfig(), h.doc);
    h.runtime.choose({ analytics: true, marketing: true });
    h.runtime.choose({ analytics: true, marketing: true });
    expect(events.map((e) => e.categories)).toEqual([ALL_DENIED, ALL_GRANTED]);
  });
});

describe("reopen control delegation", () => {
  async function withUi() {
    const h = await mounted({ ...ALL_GRANTED });
    const opened: Array<Element | null | undefined> = [];
    h.runtime.setUi({ openSettings: (opener) => opened.push(opener), close: () => {} });
    const control = h.doc.createElement("a");
    control.setAttribute("href", "#");
    control.setAttribute("data-consent", "open");
    const child = h.doc.createElement("span");
    control.append(child);
    const elsewhere = h.doc.createElement("button");
    h.doc.body.append(control, elsewhere);
    return { ...h, opened, control, child, elsewhere };
  }
  test("a click on [data-consent=open] opens the settings with that element as opener", async () => {
    const h = await withUi();
    const event = new h.window.MouseEvent("click", { bubbles: true, cancelable: true });
    h.control.dispatchEvent(event as unknown as Event);
    expect(h.opened).toEqual([h.control]);
    expect(event.defaultPrevented).toBe(true);
  });
  test("a click on a nested child of the control opens the settings", async () => {
    const h = await withUi();
    h.child.click();
    expect(h.opened).toEqual([h.control]);
  });
  test("a click elsewhere does nothing", async () => {
    const h = await withUi();
    h.elsewhere.click();
    h.doc.body.click();
    expect(h.opened).toEqual([]);
  });
  test("openSettings() delegates to the UI", async () => {
    const h = await withUi();
    h.api.openSettings();
    expect(h.opened).toHaveLength(1);
  });
  test("before mount, a click on the control does nothing", async () => {
    const h = await harness();
    const control = h.doc.createElement("button");
    control.setAttribute("data-consent", "open");
    h.doc.body.append(control);
    const event = new h.window.MouseEvent("click", { bubbles: true, cancelable: true });
    control.dispatchEvent(event as unknown as Event);
    expect(event.defaultPrevented).toBe(false);
  });
});
