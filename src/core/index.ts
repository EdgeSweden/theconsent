import "../styles.css";
import type { ConsentConfig } from "../astro/schema";
import { createUi } from "./banner";
import { renderText, resolveLocale } from "./i18n";
import { sendRecord } from "./record";
import { choose, onCommit, reflect, setUi, start } from "./runtime";
import { applyTheme } from "./theme";

export { getConsent, onConsent, openSettings, withdraw, type ConsentListener } from "./runtime";
export type { ConsentConfig, GtagConsentKey, LocaleStrings } from "../astro/schema";
export type { ThemeColor } from "./tokens";
export type { ConsentAction, ConsentRecord, ConsentRecorder, ConsentState } from "./types";

/**
 * Mounts consent on `doc` (plan: Mount). Reads the consent cookie, publishes the initial state and
 * shows the banner when there is no valid choice; nothing is written, stored or sent until the
 * visitor chooses. A second call is a no-op.
 */
export function mount(config: ConsentConfig, doc: Document = document): void {
  const store = start(config, doc);
  if (store === null) return;
  const build = () => {
    const strings = config.locales[store.locale] ?? config.locales[config.defaultLocale]!;
    const built = createUi(doc, config, strings, store, { choose }, (text) =>
      renderText(doc, text, strings.links),
    );
    applyTheme(built.root, config);
    setUi(built);
    return built;
  };
  let ui = build();

  const recorder = config.record;
  if (recorder !== undefined) {
    onCommit(({ action, choice }) =>
      sendRecord(doc.defaultView!, recorder, {
        action,
        categories: { ...choice.c },
        policyVersion: choice.p,
        packageVersion: __PACKAGE_VERSION__,
        locale: store.locale,
        at: choice.t,
      }),
    );
  }

  const attach = (): void => {
    doc.body.append(ui.root);
    if (store.choice === null) ui.show();
  };
  if (doc.body) attach();
  else doc.addEventListener("DOMContentLoaded", attach, { once: true });

  // Astro's ClientRouter swaps in a new <body> and new <html> attributes without re-running this
  // module: rebuild the UI in the page's locale on the new body and re-apply the attributes.
  doc.addEventListener("astro:after-swap", () => {
    ui.destroy();
    store.locale = resolveLocale(config, doc);
    ui = build();
    attach();
    reflect();
  });
}
