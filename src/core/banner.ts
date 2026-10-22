import type { ConsentConfig, LocaleStrings } from "../astro/schema";
import { focusables, h } from "./dom";
import type { ConsentUi } from "./runtime";
import type { ConsentStore } from "./state";
import { optionalIds } from "./state";
import { BUTTONS, type ButtonId } from "./tokens";

export interface BannerActions {
  choose(optional: Record<string, boolean>): void;
}

type View = "banner" | "settings" | null;

/**
 * The resolved first-layer button order (plan: Validation, `buttons.order`). Accept all and Reject
 * all are appended if a host mounted an unvalidated config without them (plan: Principles 2).
 */
export function buttonOrder(config: ConsentConfig): ButtonId[] {
  const settings = config.buttons?.settings !== false;
  const order = config.buttons?.order ?? BUTTONS.filter((b) => settings || b !== "settings");
  const unique = [...new Set(order)].filter((id) => BUTTONS.includes(id));
  for (const required of ["acceptAll", "rejectAll"] as const) {
    if (!unique.includes(required)) unique.push(required);
  }
  return unique;
}

/**
 * An id prefix no element in `doc` uses yet: `consent-`, else `consent1-`, `consent2-`, … so a
 * host element with the same id can never capture an `aria-labelledby` or `for` reference.
 */
function idPrefix(doc: Document): string {
  let n = 0;
  const prefix = (): string => `consent${n === 0 ? "" : n}-`;
  while (doc.querySelector(`[id^="${prefix()}"]`) !== null) n++;
  return prefix();
}

/** Trailing slashes do not distinguish two paths here. */
const trim = (path: string): string => path.replace(/\/+$/, "");

/**
 * Builds the banner and the settings dialog (plan: Runtime behaviour, Accessibility). In blocking
 * mode nothing dismisses the banner except a choice: no close control, Escape and backdrop clicks
 * are ignored, and the rest of the page is inert while a dialog is open. On a page the banner links
 * to, the page stays readable: no backdrop, no inert, no focus trap, the banner at the bottom and a
 * spacer of its height at the end of body, so the end of the page is never hidden (decision #70).
 */
export function createUi(
  doc: Document,
  config: ConsentConfig,
  strings: LocaleStrings,
  store: ConsentStore,
  actions: BannerActions,
  renderText: (text: string) => Array<Node | string>,
): ConsentUi & { root: HTMLElement; show(): void; destroy(): void } {
  const here = doc.defaultView?.location;
  const readable =
    !!here &&
    (strings.links ?? []).some((link) => {
      // An unparseable href (an unvalidated config, an about:srcdoc frame) is simply not this page.
      try {
        const url = new URL(link.href, here.href);
        return url.origin === here.origin && trim(url.pathname) === trim(here.pathname);
      } catch {
        return false;
      }
    });
  const modal = config.layout?.blocking ?? true;
  const blocking = modal && !readable;
  const dimmed = !readable && (config.layout?.backdrop ?? "dim") === "dim";
  const position = config.layout?.position ?? "bottom-center";
  const optional = optionalIds(config);
  const all = (granted: boolean) => Object.fromEntries(optional.map((id) => [id, granted]));
  const p = idPrefix(doc);

  let view: View = null;
  /** Element focused before the current dialog opened; focus returns here on close. */
  let opener: HTMLElement | null = null;
  const inerted: Element[] = [];
  /** Keeps the page inert while a blocking dialog is open (content added later included). */
  let observer: MutationObserver | null = null;

  const button = (kind: string, label: string, onClick: () => void): HTMLButtonElement => {
    const el = h(
      doc,
      "button",
      { type: "button", class: `consent__button consent__button--${kind}` },
      [label],
    );
    el.addEventListener("click", onClick);
    return el;
  };

  // --- First layer -------------------------------------------------------------------------
  const firstLayer: Record<ButtonId, () => HTMLButtonElement> = {
    acceptAll: () => button("accept", strings.acceptAll, () => actions.choose(all(true))),
    rejectAll: () => button("reject", strings.rejectAll, () => actions.choose(all(false))),
    settings: () => button("settings", strings.settings, () => openSettings(true)),
  };
  const titleText = strings.title.trim();
  const banner = h(doc, "div", {
    class: "consent__dialog consent__banner",
    role: "dialog",
    tabindex: "-1",
    hidden: true,
    ...(titleText === ""
      ? { "aria-label": strings.dialogLabel ?? "" }
      : { "aria-labelledby": `${p}title` }),
    "aria-describedby": `${p}description`,
    ...(blocking ? { "aria-modal": "true" } : {}),
  });
  if (titleText !== "")
    banner.append(h(doc, "h2", { id: `${p}title`, class: "consent__title" }, [strings.title]));
  banner.append(
    h(doc, "p", { id: `${p}description`, class: "consent__text" }, renderText(strings.description)),
    h(
      doc,
      "div",
      { class: "consent__actions" },
      buttonOrder(config).map((id) => firstLayer[id]()),
    ),
  );
  if (!modal) {
    banner.append(button("close", strings.close, () => dismiss()));
  }

  // --- Settings dialog ---------------------------------------------------------------------
  const switches = new Map<string, HTMLInputElement>();
  const categoryList = h(doc, "ul", { class: "consent__categories" });
  for (const category of config.categories) {
    const text = strings.categories[category.id];
    const required = category.required === true;
    // Distinct prefixes: no category id can make one element's id equal another's.
    const inputId = `${p}switch-${category.id}`;
    const descriptionId = `${p}about-${category.id}`;
    const input = h(doc, "input", {
      type: "checkbox",
      id: inputId,
      class: "consent__switch",
      "aria-describedby": descriptionId,
      ...(required ? { checked: true, disabled: true } : {}),
    });
    if (!required) switches.set(category.id, input);
    const head = h(doc, "div", { class: "consent__category-head" }, [
      input,
      h(doc, "label", { for: inputId, class: "consent__category-name" }, [
        text?.name ?? category.id,
      ]),
    ]);
    if (required) head.append(h(doc, "span", { class: "consent__always" }, [strings.alwaysActive]));
    const item = h(doc, "li", { class: "consent__category" }, [
      head,
      h(doc, "p", { id: descriptionId, class: "consent__muted" }, [text?.description ?? ""]),
    ]);
    const services = category.services ?? [];
    if (services.length > 0) {
      item.append(
        h(
          doc,
          "ul",
          { class: "consent__services" },
          services.map((service) => {
            const serviceText = strings.services?.[service.id];
            const li = h(doc, "li", { class: "consent__service" }, [
              h(doc, "span", { class: "consent__service-name" }, [serviceText?.name ?? service.id]),
            ]);
            if (serviceText?.description) {
              li.append(
                h(doc, "span", { class: "consent__muted" }, [` ${serviceText.description}`]),
              );
            }
            if (service.cookies && service.cookies.length > 0) {
              li.append(
                h(doc, "code", { class: "consent__cookies" }, [service.cookies.join(", ")]),
              );
            }
            return li;
          }),
        ),
      );
    }
    categoryList.append(item);
  }

  const settings = h(doc, "div", {
    class: "consent__dialog consent__settings",
    role: "dialog",
    tabindex: "-1",
    hidden: true,
    "aria-labelledby": `${p}settings-title`,
    ...(blocking ? { "aria-modal": "true" } : {}),
  });
  settings.append(
    h(doc, "h2", { id: `${p}settings-title`, class: "consent__title" }, [strings.settingsTitle]),
  );
  if (strings.settingsDescription !== undefined) {
    settings.setAttribute("aria-describedby", `${p}settings-description`);
    settings.append(
      h(
        doc,
        "p",
        { id: `${p}settings-description`, class: "consent__text" },
        renderText(strings.settingsDescription),
      ),
    );
  }
  settings.append(
    categoryList,
    h(doc, "div", { class: "consent__actions" }, [
      firstLayer.acceptAll(),
      firstLayer.rejectAll(),
      button("save", strings.save, () =>
        actions.choose(Object.fromEntries([...switches].map(([id, input]) => [id, input.checked]))),
      ),
    ]),
    button("close", strings.close, () => closeSettings()),
  );

  // --- Root ----------------------------------------------------------------------------------
  const root = h(doc, "div", {
    class: "consent",
    hidden: true,
    // A linked page keeps the alignment at the bottom: center → bottom-center, top-left → bottom-left.
    "data-position": readable ? `bottom-${position.split("-")[1] ?? "center"}` : position,
    "data-blocking": blocking ? "true" : "false",
    "data-readable": readable,
  });
  if (dimmed) root.append(h(doc, "div", { class: "consent__backdrop", "aria-hidden": "true" }));
  root.append(banner, settings);

  // A linked page: an in-flow spacer as tall as the banner plus its 1rem margin keeps the end of the
  // page scrollable into view above it.
  const spacer = h(doc, "div", { "aria-hidden": "true" });
  const sizer = readable
    ? new doc.defaultView!.ResizeObserver(() => {
        // While the settings dialog hides the banner, its last height stays (no jump).
        if (!banner.hidden)
          spacer.style.setProperty("height", `calc(${banner.offsetHeight}px + 1rem)`);
      })
    : null;

  // --- Behaviour -----------------------------------------------------------------------------
  const active = (): HTMLElement | null =>
    view === "banner" ? banner : view === "settings" ? settings : null;

  /** Makes every other child of body inert; one that already was stays host-owned. */
  function inertSiblings(): void {
    for (const sibling of doc.body.children) {
      if (sibling.contains(root) || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      if (!inerted.includes(sibling)) inerted.push(sibling);
    }
  }

  function setInert(on: boolean): void {
    if (on && observer === null && blocking && doc.body) {
      inertSiblings();
      // Content added, or re-enabled by the host, while open is made inert too; a host that
      // removes the root frees the page.
      observer = new doc.defaultView!.MutationObserver(() => {
        if (root.isConnected) inertSiblings();
        else setInert(false);
      });
      observer.observe(doc.body, { childList: true, subtree: true, attributeFilter: ["inert"] });
    } else if (!on) {
      observer?.disconnect();
      observer = null;
      for (const el of inerted.splice(0)) el.removeAttribute("inert");
    }
  }

  function render(next: View): void {
    view = next;
    banner.hidden = next !== "banner";
    settings.hidden = next !== "settings";
    root.hidden = next === null;
    root.toggleAttribute("data-open", next !== null);
    setInert(next !== null);
    // Kept while the settings dialog is open too, so the page does not jump when it opens.
    if (readable && next !== null) {
      doc.body.append(spacer);
      sizer?.observe(banner);
    } else {
      spacer.remove();
      sizer?.disconnect();
    }
    active()?.focus();
  }

  function returnFocus(): void {
    const target = opener;
    opener = null;
    if (target && target.isConnected && !root.contains(target)) target.focus();
  }

  /** Shows the first layer (on mount without a valid choice). */
  function show(): void {
    render("banner");
  }

  /** Non-blocking "decide later": nothing is stored and the banner returns on the next page. */
  function dismiss(): void {
    render(null);
    returnFocus();
  }

  function syncSwitches(): void {
    const stored = store.choice?.c ?? {};
    for (const [id, input] of switches) input.checked = stored[id] === true;
  }

  function openSettings(fromBanner = false, from: Element | null = doc.activeElement): void {
    if (view === "settings") return;
    if (!fromBanner && view === null) {
      opener = from instanceof doc.defaultView!.HTMLElement && from !== doc.body ? from : null;
    }
    syncSwitches();
    render("settings");
  }

  /** Escape or the close control: back to the banner when no valid choice exists yet. */
  function closeSettings(): void {
    if (store.choice === null) {
      render("banner");
      banner.querySelector<HTMLElement>(".consent__button--settings")?.focus();
    } else {
      render(null);
      returnFocus();
    }
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (view === "settings") {
        event.preventDefault();
        closeSettings();
      } else if (view === "banner" && !modal) {
        event.preventDefault();
        dismiss();
      }
      return;
    }
    const dialog = active();
    if (event.key !== "Tab" || !blocking || dialog === null) return;
    const items = focusables(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && (doc.activeElement === first || doc.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Blocking mode: focus that escapes the dialog (e.g. from browser chrome) is pulled back.
  const onFocusIn = (event: FocusEvent): void => {
    const dialog = active();
    if (
      blocking &&
      dialog &&
      event.target instanceof doc.defaultView!.Node &&
      !root.contains(event.target)
    ) {
      dialog.focus();
    }
  };
  doc.addEventListener("focusin", onFocusIn);

  return {
    root,
    show,
    /** Removes the UI and its document listeners, e.g. before rebuilding it after a swap. */
    destroy(): void {
      doc.removeEventListener("focusin", onFocusIn);
      setInert(false);
      view = null;
      spacer.remove();
      sizer?.disconnect();
      root.remove();
    },
    openSettings: (from?: Element | null) => openSettings(false, from ?? doc.activeElement),
    close(): void {
      if (view === null) return;
      render(null);
      returnFocus();
    },
  };
}
