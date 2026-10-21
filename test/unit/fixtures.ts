import type { ConsentConfig, LocaleStrings } from "../../src/astro/schema";

/** Neutral locale strings for the fixture config. */
export function localeStrings(lang: "en" | "sv"): LocaleStrings {
  const sv = lang === "sv";
  return {
    title: sv ? "Kakor" : "Cookies",
    description: sv
      ? "Vi använder kakor. Läs {link:policy}."
      : "We use cookies. Read the {link:policy}.",
    acceptAll: sv ? "Godkänn alla" : "Accept all",
    rejectAll: sv ? "Avvisa alla" : "Reject all",
    settings: sv ? "Inställningar" : "Settings",
    save: sv ? "Spara" : "Save",
    close: sv ? "Stäng" : "Close",
    alwaysActive: sv ? "Alltid aktiv" : "Always active",
    settingsTitle: sv ? "Kakinställningar" : "Cookie settings",
    links: [{ id: "policy", label: sv ? "kakpolicyn" : "cookie policy", href: "/cookies" }],
    categories: {
      necessary: { name: sv ? "Nödvändiga" : "Necessary", description: "-" },
      analytics: { name: sv ? "Statistik" : "Analytics", description: "-" },
      marketing: { name: sv ? "Marknadsföring" : "Marketing", description: "-" },
    },
    services: {
      session: { name: "Session" },
      stats: { name: "Stats" },
      ads: { name: "Ads" },
    },
  };
}

/** A valid config with one required and two optional categories, each with one service. */
export function baseConfig(): ConsentConfig {
  return {
    schemaVersion: 1,
    policyVersion: "2026-10",
    defaultLocale: "en",
    categories: [
      { id: "necessary", required: true, services: [{ id: "session" }] },
      { id: "analytics", services: [{ id: "stats", cookies: ["_stats"] }] },
      { id: "marketing", services: [{ id: "ads" }] },
    ],
    locales: { en: localeStrings("en"), sv: localeStrings("sv") },
  };
}
