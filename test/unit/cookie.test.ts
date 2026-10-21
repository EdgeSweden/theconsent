import { describe, expect, test } from "vitest";
import {
  decodeChoice,
  encodeChoice,
  isCurrent,
  readChoice,
  readCookies,
  serializeCookie,
  writeChoice,
  type StoredChoice,
} from "../../src/core/cookie";
import { baseConfig } from "./fixtures";
import { currentCookie, harness, storedCookie } from "./helpers";

const choice: StoredChoice = {
  v: 1,
  p: "2026-10",
  t: 1_760_000_000,
  c: { necessary: true, analytics: true, marketing: false },
};

describe("cookie codec", () => {
  test("encode/decode round trip", () => {
    expect(decodeChoice(encodeChoice(choice))).toEqual(choice);
  });
  test("the value is URL-encoded JSON in the documented shape", () => {
    expect(decodeURIComponent(encodeChoice(choice))).toBe(
      '{"v":1,"p":"2026-10","t":1760000000,"c":{"necessary":true,"analytics":true,"marketing":false}}',
    );
    expect(encodeChoice(choice)).not.toMatch(/[;,\s"]/);
  });
  test.each([
    ["not JSON", "%7Bnope"],
    ["bad escape", "%E0%A4%A"],
    ["array", encodeURIComponent("[1]")],
    ["null", encodeURIComponent("null")],
    ["wrong version", encodeURIComponent('{"v":2,"p":"x","t":1,"c":{}}')],
    ["missing p", encodeURIComponent('{"v":1,"t":1,"c":{}}')],
    ["string t", encodeURIComponent('{"v":1,"p":"x","t":"1","c":{}}')],
    ["non-boolean category", encodeURIComponent('{"v":1,"p":"x","t":1,"c":{"a":1}}')],
    ["array c", encodeURIComponent('{"v":1,"p":"x","t":1,"c":[]}')],
  ])("unparseable (%s) is treated as absent", (_name, raw) => {
    expect(decodeChoice(raw)).toBeNull();
  });

  test("readCookies finds the named cookie among foreign ones", () => {
    const doc = { cookie: "a=1; consent=xyz; consent_old=2" } as Document;
    expect(readCookies(doc, "consent")).toEqual(["xyz"]);
    expect(readCookies(doc, "other")).toEqual([]);
    expect(readCookies({ cookie: "consentx=1; xconsent=2" } as Document, "consent")).toEqual([]);
  });
});

describe("cookie validity against the config", () => {
  const config = baseConfig();
  test("same policyVersion and category set is current", () => {
    expect(isCurrent(choice, config)).toBe(true);
  });
  test("a changed policyVersion is not current", () => {
    expect(isCurrent({ ...choice, p: "2026-09" }, config)).toBe(false);
  });
  test("an added category is not current", () => {
    const c = { ...choice.c };
    delete c.marketing;
    expect(isCurrent({ ...choice, c }, config)).toBe(false);
  });
  test("a removed category is not current", () => {
    expect(isCurrent({ ...choice, c: { ...choice.c, social: true } }, config)).toBe(false);
  });
  test("a required category stored as false is not current", () => {
    expect(isCurrent({ ...choice, c: { ...choice.c, necessary: false } }, config)).toBe(false);
  });
  test("with several same-name cookies, the newest current one wins", () => {
    const old = { ...choice, p: "2026-09", t: 1_770_000_000 };
    const older = { ...choice, t: 1_700_000_000, c: { ...choice.c, analytics: false } };
    const doc = {
      cookie: `consent=${encodeChoice(old)}; consent=${encodeChoice(older)}; consent=${encodeChoice(choice)}; consent=%7Bjunk`,
    } as Document;
    expect(readChoice(doc, config)).toEqual(choice);
  });
  test("a stale cookie listed first does not hide a current one", () => {
    const stale = { ...choice, p: "2026-09", t: 1_790_000_000 };
    const doc = {
      cookie: `consent=${encodeChoice(stale)}; consent=${encodeChoice(choice)}`,
    } as Document;
    expect(readChoice(doc, config)).toEqual(choice);
  });
  test("a foreign cookie with the same shape under another name is ignored", async () => {
    const { doc } = await harness({ cookie: storedCookie({ c: choice.c }, "other") });
    expect(readChoice(doc, config)).toBeNull();
  });
});

describe("cookie attributes", () => {
  const config = baseConfig();
  test("defaults: Max-Age 365 days, Path=/, SameSite=Lax, host-only", () => {
    const cookie = serializeCookie(config, choice, false);
    expect(cookie).toBe(`consent=${encodeChoice(choice)}; Max-Age=31536000; Path=/; SameSite=Lax`);
  });
  test("Secure only when requested (https)", () => {
    expect(serializeCookie(config, choice, true)).toMatch(/; Secure$/);
    expect(serializeCookie(config, choice, false)).not.toMatch(/Secure/);
  });
  test("name, maxAgeDays, domain and path propagate", () => {
    const cookie = serializeCookie(
      { ...config, cookie: { name: "c", maxAgeDays: 30, domain: "example.com", path: "/app" } },
      choice,
      false,
    );
    expect(cookie).toBe(
      `c=${encodeChoice(choice)}; Max-Age=2592000; Path=/app; SameSite=Lax; Domain=example.com`,
    );
  });
  test("writeChoice sets Secure on https pages", async () => {
    const h = await harness({ url: "https://example.com/" });
    writeChoice(h.doc, config, choice);
    expect(h.cookieWrites).toEqual([serializeCookie(config, choice, true)]);
    expect(currentCookie(h.doc)).toEqual(choice);
  });
  test("writeChoice omits Secure on http pages", async () => {
    const h = await harness({ url: "http://example.com/" });
    writeChoice(h.doc, config, choice);
    expect(h.cookieWrites).toEqual([serializeCookie(config, choice, false)]);
  });
});
