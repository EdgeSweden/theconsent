import { describe, expect, test } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { baseConfig } from "./fixtures";
import { ALL_GRANTED, harness, storedCookie } from "./helpers";

const consentMode: NonNullable<ConsentConfig["consentMode"]> = {
  mapping: {
    necessary: ["security_storage"],
    analytics: ["analytics_storage"],
    marketing: ["ad_storage", "ad_user_data", "ad_personalization"],
  },
  extra: { functionality_storage: "granted" },
};

async function tagged(
  options: { stored?: Record<string, boolean>; config?: Partial<ConsentConfig> } = {},
) {
  const h = await harness({
    cookie: options.stored ? storedCookie({ c: options.stored }) : undefined,
  });
  const gtag = await import("../../src/gtag/index");
  const win = h.window as unknown as Window;
  const config: ConsentConfig = { ...baseConfig(), consentMode, ...options.config };
  /** dataLayer entries as plain arrays. */
  const pushes = () =>
    (win.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
  return { ...h, gtag, win, config, pushes };
}

const DEFAULT = [
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
];

describe("Consent Mode v2", () => {
  test("the default push denies optional keys, grants required keys and applies extra", async () => {
    const t = await tagged();
    t.gtag.installConsentMode(t.config, t.win);
    expect(t.pushes()).toEqual([DEFAULT]);
  });

  test("entries are Arguments objects, as gtag.js expects", async () => {
    const t = await tagged();
    t.gtag.installConsentMode(t.config, t.win);
    expect(Object.prototype.toString.call(t.win.dataLayer![0])).toBe("[object Arguments]");
  });

  test("no update before a choice when nothing optional is granted", async () => {
    const t = await tagged();
    t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    expect(t.pushes()).toEqual([DEFAULT]);
  });

  test("a stored grant pushes an update at mount, after the default", async () => {
    const t = await tagged({ stored: { necessary: true, analytics: true, marketing: false } });
    t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    expect(t.pushes()).toEqual([
      DEFAULT,
      [
        "consent",
        "update",
        {
          security_storage: "granted",
          analytics_storage: "granted",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
    ]);
  });

  test("each change pushes an update per the mapping; extra is not repeated", async () => {
    const t = await tagged();
    t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    t.runtime.choose({ analytics: true, marketing: true });
    t.api.withdraw();
    expect(t.pushes().slice(1)).toEqual([
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
      [
        "consent",
        "update",
        {
          security_storage: "granted",
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
    ]);
  });

  test("a change that leaves every mapped key the same pushes nothing", async () => {
    const config = {
      ...baseConfig(),
      consentMode: { mapping: { analytics: ["analytics_storage" as const] } },
    };
    const t = await tagged({ config });
    t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    t.runtime.choose({ marketing: true });
    expect(t.pushes()).toEqual([["consent", "default", { analytics_storage: "denied" }]]);
  });

  test("an existing dataLayer is kept and appended to", async () => {
    const t = await tagged();
    t.win.dataLayer = [{ event: "page" }];
    t.gtag.installConsentMode(t.config, t.win);
    expect(t.win.dataLayer).toHaveLength(2);
    expect(t.win.dataLayer[0]).toEqual({ event: "page" });
  });

  test("without consentMode nothing is pushed and no dataLayer is created", async () => {
    const t = await tagged({ stored: ALL_GRANTED, config: { consentMode: undefined } });
    const dispose = t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    expect(t.win.dataLayer).toBeUndefined();
    expect(() => dispose()).not.toThrow();
  });

  test("the disposer stops updates", async () => {
    const t = await tagged();
    const dispose = t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    dispose();
    t.runtime.choose({ analytics: true });
    expect(t.pushes()).toEqual([DEFAULT]);
  });

  test("install is the shared adapter name", async () => {
    const t = await tagged();
    expect(t.gtag.install).toBe(t.gtag.installConsentMode);
  });

  test("a dataLayer replaced after install still receives later updates", async () => {
    const t = await tagged();
    t.gtag.installConsentMode(t.config, t.win);
    t.api.mount(t.config, t.doc);
    t.win.dataLayer = [];
    t.runtime.choose({ analytics: true });
    expect(t.pushes()).toEqual([
      [
        "consent",
        "update",
        expect.objectContaining({ analytics_storage: "granted", ad_storage: "denied" }),
      ],
    ]);
  });
});
