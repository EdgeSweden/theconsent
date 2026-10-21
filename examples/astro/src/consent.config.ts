import type { ConsentConfig, ConsentRecord, LocaleStrings } from "@edgesweden/consent";

/** Records are handed to the page, which lists them (see the layout). */
function record(entry: ConsentRecord): void {
  document.dispatchEvent(new CustomEvent("demo:record", { detail: entry }));
}

const en: LocaleStrings = {
  title: "Cookies on this demo",
  description:
    "Necessary cookies keep the demo working. With your permission we also use analytics and marketing cookies. Read the {link:policy}.",
  acceptAll: "Accept all",
  rejectAll: "Reject all",
  settings: "Settings",
  save: "Save choices",
  close: "Close",
  alwaysActive: "Always active",
  settingsTitle: "Cookie settings",
  settingsDescription: "Choose which optional categories to allow. See the {link:policy}.",
  links: [{ id: "policy", label: "cookie policy", href: "/cookies/" }],
  categories: {
    necessary: { name: "Necessary", description: "Required for the demo to work." },
    analytics: { name: "Analytics", description: "Anonymous statistics about page use." },
    marketing: { name: "Marketing", description: "Content tailored to your interests." },
  },
  services: {
    session: { name: "Session", description: "Keeps your consent choice." },
    stats: { name: "Demo statistics", description: "A local stand-in for an analytics tool." },
    ads: { name: "Demo ads", description: "A local stand-in for an advertising tool." },
  },
};

const sv: LocaleStrings = {
  title: "Kakor på den här demon",
  description:
    "Nödvändiga kakor håller demon igång. Med ditt tillstånd använder vi även statistik- och marknadsföringskakor. Läs {link:policy}.",
  acceptAll: "Godkänn alla",
  rejectAll: "Avvisa alla",
  settings: "Inställningar",
  save: "Spara val",
  close: "Stäng",
  alwaysActive: "Alltid aktiv",
  settingsTitle: "Kakinställningar",
  settingsDescription: "Välj vilka valfria kategorier du tillåter. Se {link:policy}.",
  links: [{ id: "policy", label: "kakpolicyn", href: "/sv/kakor/" }],
  categories: {
    necessary: { name: "Nödvändiga", description: "Krävs för att demon ska fungera." },
    analytics: { name: "Statistik", description: "Anonym statistik om sidvisningar." },
    marketing: { name: "Marknadsföring", description: "Innehåll anpassat efter dina intressen." },
  },
  services: {
    session: { name: "Session", description: "Sparar ditt samtyckesval." },
    stats: { name: "Demostatistik", description: "En lokal ersättare för ett statistikverktyg." },
    ads: { name: "Demoannonser", description: "En lokal ersättare för ett annonsverktyg." },
  },
};

const config: ConsentConfig = {
  schemaVersion: 1,
  policyVersion: "2026-10",
  defaultLocale: "en",
  categories: [
    { id: "necessary", required: true, services: [{ id: "session", cookies: ["consent"] }] },
    { id: "analytics", services: [{ id: "stats", cookies: ["demo_stats"] }] },
    { id: "marketing", services: [{ id: "ads", cookies: ["demo_ads"] }] },
  ],
  locales: { en, sv },
  layout: { position: "bottom-center" },
  gateScripts: true,
  consentMode: {
    mapping: {
      necessary: ["security_storage"],
      analytics: ["analytics_storage"],
      marketing: ["ad_storage", "ad_user_data", "ad_personalization"],
    },
    extra: { functionality_storage: "granted" },
  },
  record,
};

export default config;
