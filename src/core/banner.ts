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
 * Builds the banner and the settings dialog (plan: Runtime behaviour, Accessibility). In blocking
 * mode nothing dismisses the banner except a choice: no close control, Escape and backdrop clicks
 * are ignored, and the rest of the page is inert while a dialog is open.
 */
export function createUi(
  doc: Document,
  config: ConsentConfig,
  strings: LocaleStrings,
  store: ConsentStore,
  actions: BannerActions,
  renderText: (text: string) => Array<Node | string>,
): ConsentUi & { root: HTMLElement; show(): void; destroy(): void } {
  const blocking = config.layout?.blocking ?? true;
  const dimmed = (config.layout?.backdrop ?? "dim") === "dim";
  const optional = optionalIds(config);
  const all = (granted: boolean) => Object.fromEntries(optional.map((id) => [id, granted]));

  let view: View = null;
  /** Element focused before the current dialog opened; focus returns here on close. */
  let opener: HTMLElement | null = null;
  const inerted: Element[] = [];

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
      : { "aria-labelledby": "consent-title" }),
    "aria-describedby": "consent-description",
    ...(blocking ? { "aria-modal": "true" } : {}),
  });
  if (titleText !== "")
    banner.append(h(doc, "h2", { id: "consent-title", class: "consent__title" }, [strings.title]));
  banner.append(
    h(
      doc,
      "p",
      { id: "consent-description", class: "consent__text" },
      renderText(strings.description),
    ),
    h(
      doc,
      "div",
      { class: "consent__actions" },
      buttonOrder(config).map((id) => firstLayer[id]()),
    ),
  );
  if (!blocking) {
    banner.append(button("close", strings.close, () => dismiss()));
  }

  // --- Settings dialog ---------------------------------------------------------------------
  const switches = new Map<string, HTMLInputElement>();
  const categoryList = h(doc, "ul", { class: "consent__categories" });
  for (const category of config.categories) {
    const text = strings.categories[category.id];
    const required = category.required === true;
    // Distinct prefixes: no category id can make one element's id equal another's.
    const inputId = `consent-switch-${category.id}`;
    const descriptionId = `consent-about-${category.id}`;
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
    "aria-labelledby": "consent-settings-title",
    ...(blocking ? { "aria-modal": "true" } : {}),
  });
  settings.append(
    h(doc, "h2", { id: "consent-settings-title", class: "consent__title" }, [
      strings.settingsTitle,
    ]),
  );
  if (strings.settingsDescription !== undefined) {
    settings.setAttribute("aria-describedby", "consent-settings-description");
    settings.append(
      h(
        doc,
        "p",
        { id: "consent-settings-description", class: "consent__text" },
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
    "data-position": config.layout?.position ?? "bottom-center",
    "data-blocking": blocking ? "true" : "false",
  });
  if (dimmed) root.append(h(doc, "div", { class: "consent__backdrop", "aria-hidden": "true" }));
  root.append(banner, settings);

  // --- Behaviour -----------------------------------------------------------------------------
  const active = (): HTMLElement | null =>
    view === "banner" ? banner : view === "settings" ? settings : null;

  function setInert(on: boolean): void {
    if (on && inerted.length === 0 && blocking && doc.body) {
      for (const sibling of doc.body.children) {
        if (sibling !== root && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
    } else if (!on) {
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
      } else if (view === "banner" && !blocking) {
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
