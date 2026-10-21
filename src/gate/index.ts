// Types come through the core entry so the emitted declarations never reference ./astro.
import { getConsent, onConsent, type ConsentConfig, type ConsentState } from "../core/index";

const SELECTOR = 'script[type="text/plain"][data-consent]';

/** Classic script types a browser executes (HTML: "JavaScript MIME type essence match"). */
const CLASSIC_TYPE =
  /^((text|application)\/(x-)?(java|ecma)script|text\/javascript1\.[0-5]|text\/(jscript|livescript))$/;

/**
 * Script gating (plan: Script gating). On every consent state, each
 * `<script type="text/plain" data-consent="<id>">` whose category is granted is replaced, once, by
 * a live script with the same attributes and text. Denied scripts are left untouched. Required
 * categories are granted from mount, so their scripts run then. `data-type`, if present, becomes
 * the live script's `type` (for example `module`).
 *
 * Activated scripts keep the order they would have without gating: classic scripts in page
 * order (each inserted only after every earlier external classic script without `async` has
 * loaded or failed), modules in page order among themselves.
 *
 * Does nothing unless `config.gateScripts` is `true`. Returns a disposer that stops further
 * activation; scripts that already ran cannot be undone.
 */
export function installScriptGating(config: ConsentConfig, doc: Document = document): () => void {
  if (config.gateScripts !== true) return () => {};
  /** Placeholders already claimed; their replacement may still be waiting in the chain. */
  const claimed = new WeakSet<Element>();
  let chain: Promise<void> = Promise.resolve();
  let active = true;
  /** External scripts already activated in this document, by resolved URL. */
  const ran = new Set<string>();

  const activate = (placeholder: HTMLScriptElement): Promise<void> => {
    if (!active || !placeholder.isConnected) return Promise.resolve();
    // An external script URL is loaded at most once per document: after a client-side
    // navigation the new page repeats its placeholders. Recorded only when actually inserted, so
    // a placeholder that a swap detached before its turn does not block the URL.
    if (placeholder.src !== "") {
      if (ran.has(placeholder.src)) return Promise.resolve();
      ran.add(placeholder.src);
    }
    const live = doc.createElement("script");
    for (const { name, value } of placeholder.attributes) {
      if (name !== "type" && name !== "data-type") live.setAttribute(name, value);
    }
    // A nonce is hidden from getAttribute once the page has loaded; copy the property.
    if (placeholder.nonce) live.nonce = placeholder.nonce;
    const type = placeholder.getAttribute("data-type");
    if (type !== null) live.setAttribute("type", type);
    live.text = placeholder.text;
    // Keep the parser's order unless the page asked for async, as a page without gating would:
    // classic scripts in page order, modules in page order among themselves (modules are
    // deferred, so a classic script after a module may run first). An inline classic script runs
    // during insertion; an external one is waited for, since a script inserted later would
    // otherwise run before it. Modules inserted with async false are ordered by the browser, and
    // an inline module fires no load event, so modules are never waited for. A classic script
    // the browser skips (nomodule, an unknown type) fires no event and is not waited for either.
    const kind = (type ?? "").trim().toLowerCase();
    const classic = (kind === "" || CLASSIC_TYPE.test(kind)) && !live.hasAttribute("nomodule");
    const isAsync = placeholder.hasAttribute("async");
    // Only a module without async gets async = false, which puts it in the browser's in-order
    // list. Classic scripts are left as copied: an inserted classic script is already async by
    // default (no attribute is added), and the chain orders them itself.
    if (kind === "module" && !isAsync) live.async = false;
    const done =
      classic && live.src !== "" && !isAsync
        ? new Promise<void>((resolve) => {
            live.addEventListener("load", () => resolve(), { once: true });
            live.addEventListener("error", () => resolve(), { once: true });
          })
        : Promise.resolve();
    // Astro's ClientRouter re-runs scripts without this marker after a navigation. It is the one
    // attribute the live script has that the placeholder did not (documented in the README).
    live.setAttribute("data-astro-exec", "");
    placeholder.replaceWith(live);
    return done;
  };

  const pass = (state: ConsentState | null): void => {
    if (state === null) return;
    for (const placeholder of doc.querySelectorAll<HTMLScriptElement>(SELECTOR)) {
      const category = placeholder.getAttribute("data-consent") ?? "";
      if (state.categories[category] !== true || claimed.has(placeholder)) continue;
      claimed.add(placeholder);
      // A failing activation must not stall the ones after it.
      chain = chain.then(() => activate(placeholder)).catch(() => {});
    }
  };

  // Installed before the body was parsed: look again once the placeholders exist.
  const onReady = (): void => pass(getConsent());
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", onReady, { once: true });
  }
  // Astro's ClientRouter swaps in a new <body> with its own placeholders. Rescan once the router
  // has run the new page's scripts, so a script activated here is not run again by the router.
  doc.addEventListener("astro:page-load", onReady);
  const unsubscribe = onConsent(pass);
  return () => {
    active = false;
    unsubscribe();
    doc.removeEventListener("DOMContentLoaded", onReady);
    doc.removeEventListener("astro:page-load", onReady);
  };
}

export { installScriptGating as install };
