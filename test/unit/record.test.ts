import { describe, expect, test, vi } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import type { ConsentRecord } from "../../src/core/types";
import { baseConfig } from "./fixtures";
import { ALL_DENIED, ALL_GRANTED, harness, storedCookie } from "./helpers";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function recorded(
  record: ConsentConfig["record"],
  options: { stored?: Record<string, boolean>; lang?: string } = {},
) {
  const h = await harness({
    lang: options.lang ?? "en",
    cookie: options.stored ? storedCookie({ c: options.stored }) : undefined,
  });
  h.api.mount({ ...baseConfig(), record }, h.doc);
  const q = (text: string) =>
    [...h.doc.querySelectorAll<HTMLButtonElement>(".consent button")].find(
      (b) => b.textContent === text && !b.closest("[hidden]"),
    )!;
  return { ...h, q };
}

describe("record: function form", () => {
  test("called once per choice with the documented payload", async () => {
    vi.useFakeTimers({ now: 1_770_000_000_500 });
    try {
      const recorder = vi.fn();
      const h = await recorded(recorder);
      h.q("Accept all").click();
      expect(recorder).toHaveBeenCalledTimes(1);
      expect(recorder.mock.calls[0]![0]).toEqual({
        action: "accept_all",
        categories: ALL_GRANTED,
        policyVersion: "2026-10",
        packageVersion: __PACKAGE_VERSION__,
        locale: "en",
        at: 1_770_000_000,
      } satisfies ConsentRecord);
    } finally {
      vi.useRealTimers();
    }
  });
  test("the payload carries no identifier, user agent or page", async () => {
    const recorder = vi.fn();
    const h = await recorded(recorder);
    h.q("Reject all").click();
    expect(Object.keys(recorder.mock.calls[0]![0]).sort()).toEqual(
      ["action", "at", "categories", "locale", "packageVersion", "policyVersion"].sort(),
    );
  });
  test("locale is always present and is the resolved locale", async () => {
    const recorder = vi.fn();
    const h = await recorded(recorder, { lang: "sv-SE" });
    h.q("Avvisa alla").click();
    expect(recorder.mock.calls[0]![0]).toMatchObject({ locale: "sv", action: "reject_all" });
  });
  test("the action follows the transition: withdraw after a grant", async () => {
    const recorder = vi.fn();
    const h = await recorded(recorder, { stored: ALL_GRANTED });
    h.api.withdraw();
    expect(recorder.mock.calls[0]![0]).toMatchObject({
      action: "withdraw",
      categories: ALL_DENIED,
    });
  });
  test("no record on a no-op", async () => {
    const recorder = vi.fn();
    const h = await recorded(recorder, { stored: ALL_DENIED });
    h.api.withdraw();
    h.api.openSettings();
    h.q("Save").click();
    expect(recorder).not.toHaveBeenCalled();
  });
  test("no record before a choice, nor on a non-blocking close", async () => {
    const recorder = vi.fn();
    const h = await harness();
    h.api.mount(
      { ...baseConfig(), record: recorder, layout: { blocking: false, backdrop: "none" } },
      h.doc,
    );
    expect(recorder).not.toHaveBeenCalled();
    [...h.doc.querySelectorAll<HTMLButtonElement>(".consent__banner button")]
      .find((b) => b.textContent === "Close")!
      .click();
    expect(recorder).not.toHaveBeenCalled();
  });
  test("a throwing recorder is swallowed; the choice still stands", async () => {
    const h = await recorded(() => {
      throw new Error("boom");
    });
    expect(() => h.q("Accept all").click()).not.toThrow();
    expect(h.api.getConsent()!.categories).toEqual(ALL_GRANTED);
  });
  test("a rejecting recorder is swallowed", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const h = await recorded(async () => {
        throw new Error("boom");
      });
      h.q("Accept all").click();
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });
  test("the recorder gets its own copy of the categories", async () => {
    const recorder = vi.fn((record: ConsentRecord) => {
      record.categories.marketing = true;
    });
    const h = await recorded(recorder);
    h.q("Reject all").click();
    expect(h.api.getConsent()!.categories.marketing).toBe(false);
  });
});

describe("record: URL form", () => {
  test("posts the bare record as JSON with sendBeacon", async () => {
    const h = await recorded("/consent");
    h.q("Accept all").click();
    expect(h.sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = h.sendBeacon.mock.calls[0]! as unknown as [string, Blob];
    expect(url).toBe("/consent");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toMatchObject({
      action: "accept_all",
      categories: ALL_GRANTED,
      locale: "en",
    });
    expect(h.fetch).not.toHaveBeenCalled();
  });
  test("falls back to fetch with keepalive when sendBeacon refuses", async () => {
    const h = await recorded("https://example.com/consent");
    h.sendBeacon.mockReturnValue(false);
    h.q("Reject all").click();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/consent");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toMatchObject({ action: "reject_all" });
  });
  test("falls back to fetch when sendBeacon throws or is missing", async () => {
    const throwing = await recorded("/consent");
    throwing.sendBeacon.mockImplementation(() => {
      throw new TypeError("not allowed");
    });
    throwing.q("Accept all").click();
    expect(throwing.fetch).toHaveBeenCalledTimes(1);

    const missing = await recorded("/consent");
    Object.defineProperty(missing.window.navigator, "sendBeacon", {
      configurable: true,
      value: undefined,
    });
    missing.q("Accept all").click();
    expect(missing.fetch).toHaveBeenCalledTimes(1);
  });
  test("a rejected fetch is swallowed", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const h = await recorded("/consent");
      h.sendBeacon.mockReturnValue(false);
      h.fetch.mockRejectedValue(new TypeError("offline"));
      h.q("Accept all").click();
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });
  test("a fetch that throws synchronously is swallowed", async () => {
    const h = await recorded("/consent");
    h.sendBeacon.mockReturnValue(false);
    h.fetch.mockImplementation(() => {
      throw new TypeError("bad");
    });
    expect(() => h.q("Accept all").click()).not.toThrow();
    expect(h.api.getConsent()!.categories).toEqual(ALL_GRANTED);
  });
  test("no request on a no-op or before a choice", async () => {
    const h = await recorded("/consent", { stored: ALL_GRANTED });
    expect(h.sendBeacon).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
    h.api.openSettings();
    h.q("Save").click();
    expect(h.sendBeacon).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
