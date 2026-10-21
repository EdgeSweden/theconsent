// Types come through the core entry so the emitted declarations never reference ./astro.
import {
  onConsent,
  type ConsentConfig,
  type ConsentState,
  type GtagConsentKey,
} from "../core/index";

type ConsentValue = "granted" | "denied";
type ConsentPayload = Partial<Record<GtagConsentKey, ConsentValue>>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Google Consent Mode v2 (plan: Google Consent Mode v2). Pushes `gtag("consent", "default", …)`
 * at once, with every key of an optional category denied, every key of a required category
 * granted and `extra` as configured, then `gtag("consent", "update", …)` per the mapping whenever
 * the state differs from what was last pushed. Everything goes through `window.dataLayer`; no tag
 * is loaded. Does nothing without `config.consentMode`. Returns a disposer.
 */
export function installConsentMode(config: ConsentConfig, win: Window = window): () => void {
  const consentMode = config.consentMode;
  if (consentMode === undefined) return () => {};
  // gtag.js reads the arguments object, not an array, exactly as Google's snippet pushes it.
  // `window.dataLayer` is looked up on every push: a site snippet may replace the array later.
  const gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    (win.dataLayer ??= []).push(arguments);
  } as (...args: unknown[]) => void;

  const required = new Set(config.categories.filter((c) => c.required === true).map((c) => c.id));
  const payload = (granted: (category: string) => boolean): ConsentPayload => {
    const out: ConsentPayload = {};
    for (const [category, keys] of Object.entries(consentMode.mapping)) {
      for (const key of keys) out[key] = granted(category) ? "granted" : "denied";
    }
    return out;
  };

  let last = payload((category) => required.has(category));
  gtag("consent", "default", { ...last, ...consentMode.extra });

  return onConsent((state: ConsentState) => {
    const next = payload((category) => state.categories[category] === true);
    if (JSON.stringify(next) === JSON.stringify(last)) return;
    last = next;
    gtag("consent", "update", next);
  });
}

export { installConsentMode as install };
