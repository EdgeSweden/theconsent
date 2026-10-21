import { Window } from "happy-dom";
import { describe, expect, test } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { resolveLocale } from "../../src/core/i18n";
import { baseConfig, localeStrings } from "./fixtures";

function docWithLang(lang: string | null): Document {
  const doc = new Window().document as unknown as Document;
  if (lang !== null) doc.documentElement.lang = lang;
  return doc;
}

const config = (extra: Partial<ConsentConfig> = {}): ConsentConfig => ({
  ...baseConfig(),
  locales: { en: localeStrings("en"), sv: localeStrings("sv"), "pt-BR": localeStrings("en") },
  ...extra,
});

describe("locale resolution", () => {
  test("config.locale wins over <html lang>", () => {
    expect(resolveLocale(config({ locale: "sv" }), docWithLang("en"))).toBe("sv");
  });
  test("<html lang> exact match", () => {
    expect(resolveLocale(config(), docWithLang("sv"))).toBe("sv");
    expect(resolveLocale(config(), docWithLang("pt-BR"))).toBe("pt-BR");
  });
  test("<html lang> matches case-insensitively", () => {
    expect(resolveLocale(config(), docWithLang("SV"))).toBe("sv");
    expect(resolveLocale(config(), docWithLang("pt-br"))).toBe("pt-BR");
  });
  test("lang without region: sv-SE → sv", () => {
    expect(resolveLocale(config(), docWithLang("sv-SE"))).toBe("sv");
  });
  test("defaultLocale when nothing matches", () => {
    expect(resolveLocale(config({ defaultLocale: "sv" }), docWithLang("de-DE"))).toBe("sv");
  });
  test("defaultLocale when <html lang> is missing or empty", () => {
    expect(resolveLocale(config({ defaultLocale: "sv" }), docWithLang(null))).toBe("sv");
    expect(resolveLocale(config({ defaultLocale: "sv" }), docWithLang(""))).toBe("sv");
  });
  test("the resolved locale is never empty and is reported in the state", async () => {
    const { harness } = await import("./helpers");
    const h = await harness({ lang: "sv-SE" });
    h.api.mount(config(), h.doc);
    expect(h.api.getConsent()!.locale).toBe("sv");
  });
});

describe("link tokens", () => {
  const links = [
    { id: "policy", label: "cookie policy", href: "/cookies" },
    { id: "terms", label: "terms", href: "https://example.com/terms" },
  ];
  const doc = () => new Window().document as unknown as Document;
  const describeNodes = (nodes: Array<Node | string>) =>
    nodes.map((node) =>
      typeof node === "string"
        ? node
        : `<a href=${(node as HTMLAnchorElement).getAttribute("href")}>${node.textContent}</a>`,
    );

  test("plain text stays a single text part", async () => {
    const { renderText } = await import("../../src/core/i18n");
    expect(renderText(doc(), "No links here.", links)).toEqual(["No links here."]);
  });
  test("{link:<id>} tokens become anchors with the locale's label and href", async () => {
    const { renderText } = await import("../../src/core/i18n");
    expect(
      describeNodes(renderText(doc(), "Read the {link:policy} and {link:terms}.", links)),
    ).toEqual([
      "Read the ",
      "<a href=/cookies>cookie policy</a>",
      " and ",
      "<a href=https://example.com/terms>terms</a>",
      ".",
    ]);
  });
  test("markup in strings is rendered as text, never parsed", async () => {
    const { renderText } = await import("../../src/core/i18n");
    const parts = renderText(doc(), "<img src=x onerror=alert(1)> {link:policy}", [
      { id: "policy", label: "<b>bold</b>", href: "/p" },
    ]);
    expect(parts[0]).toBe("<img src=x onerror=alert(1)> ");
    expect((parts[1] as HTMLElement).children).toHaveLength(0);
    expect((parts[1] as HTMLElement).textContent).toBe("<b>bold</b>");
  });
  test("an unknown token is left as literal text", async () => {
    const { renderText } = await import("../../src/core/i18n");
    expect(renderText(doc(), "{link:missing}", links)).toEqual(["", "{link:missing}", ""]);
  });
  test("the banner description renders the link of the resolved locale", async () => {
    const { harness } = await import("./helpers");
    const h = await harness({ lang: "sv" });
    h.api.mount(config(), h.doc);
    const anchor = h.doc.querySelector<HTMLAnchorElement>("#consent-description a")!;
    expect(anchor.textContent).toBe("kakpolicyn");
    expect(anchor.getAttribute("href")).toBe("/cookies");
  });
  test("the settings description renders links too", async () => {
    const { harness } = await import("./helpers");
    const h = await harness();
    const c = config();
    c.locales.en!.settingsDescription = "Details in the {link:policy}.";
    h.api.mount(c, h.doc);
    expect(h.doc.querySelector(".consent__settings .consent__text a")!.textContent).toBe(
      "cookie policy",
    );
  });
  test("switching <html lang> changes every string on the next page", async () => {
    const { harness } = await import("./helpers");
    const texts = async (lang: string) => {
      const h = await harness({ lang });
      h.api.mount(config(), h.doc);
      return [...h.doc.querySelectorAll(".consent h2, .consent button, .consent label")].map(
        (e) => e.textContent,
      );
    };
    expect(await texts("en")).toEqual([
      "Cookies",
      "Accept all",
      "Reject all",
      "Settings",
      "Cookie settings",
      "Necessary",
      "Analytics",
      "Marketing",
      "Accept all",
      "Reject all",
      "Save",
      "Close",
    ]);
    expect(await texts("sv")).toEqual([
      "Kakor",
      "Godkänn alla",
      "Avvisa alla",
      "Inställningar",
      "Kakinställningar",
      "Nödvändiga",
      "Statistik",
      "Marknadsföring",
      "Godkänn alla",
      "Avvisa alla",
      "Spara",
      "Stäng",
    ]);
  });
});
