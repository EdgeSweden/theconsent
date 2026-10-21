import type { ConsentConfig } from "../astro/schema";
import { resolveLocale } from "./i18n";
import { ConsentStore, optionalIds, type Commit } from "./state";
import type { ConsentState } from "./types";

export type ConsentListener = (state: ConsentState) => void;

/** UI hooks the banner registers at mount (plan: Runtime behaviour). */
export interface ConsentUi {
  /** Opens the settings dialog; focus returns to `opener` (default: the focused element). */
  openSettings(opener?: Element | null): void;
  /**
   * Called for every choice, including a no-op, before the new state is published, so consumers
   * see the banner already closed.
   */
  close(): void;
}

interface Runtime {
  doc: Document;
  store: ConsentStore;
  ui: ConsentUi | null;
}

let runtime: Runtime | null = null;
/** One entry per subscription, so subscribing the same function twice is two subscriptions. */
const listeners = new Set<{ listener: ConsentListener }>();
const afterCommit: Array<(commit: Commit, state: ConsentState) => void> = [];

/** A listener that throws must not stop the others or the commit; report it asynchronously. */
function safeCall(listener: ConsentListener, state: ConsentState): void {
  try {
    listener(state);
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

function mirror(doc: Document, state: ConsentState): void {
  for (const [id, granted] of Object.entries(state.categories)) {
    doc.documentElement.setAttribute(`data-consent-${id}`, granted ? "granted" : "denied");
  }
}

/** Re-applies the `<html>` attributes, e.g. after a client-side navigation replaced them. */
export function reflect(): void {
  if (runtime) mirror(runtime.doc, runtime.store.state());
}

function publish(doc: Document, state: ConsentState): void {
  mirror(doc, state);
  for (const { listener } of [...listeners]) safeCall(listener, copy(state));
  doc.dispatchEvent(new CustomEvent("consent:change", { detail: copy(state) }));
}

const copy = (state: ConsentState): ConsentState => ({
  ...state,
  categories: { ...state.categories },
});

/** Starts the runtime on `doc`. A second call is a no-op. Returns the store for the UI. */
export function start(config: ConsentConfig, doc: Document): ConsentStore | null {
  if (runtime !== null) return null;
  const store = new ConsentStore(doc, config, resolveLocale(config, doc));
  runtime = { doc, store, ui: null };

  // Any element with data-consent="open" reopens the settings dialog (plan: State API).
  doc.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof doc.defaultView!.Element)) return;
    const opener = target.closest('[data-consent="open"]');
    if (opener === null || runtime?.ui == null) return;
    event.preventDefault();
    runtime.ui.openSettings(opener);
  });

  publish(doc, store.state());
  return store;
}

export function setUi(ui: ConsentUi): void {
  if (runtime) runtime.ui = ui;
}

/** Registers a hook run after each committed choice (the record hook uses this). */
export function onCommit(hook: (commit: Commit, state: ConsentState) => void): void {
  afterCommit.push(hook);
}

/** Applies a choice over the optional categories and closes the UI (plan: Choice). */
export function choose(optional: Readonly<Record<string, boolean>>): void {
  if (!runtime) return;
  const commit = runtime.store.choose(optional);
  runtime.ui?.close();
  if (commit === null) return;
  const state = runtime.store.state();
  publish(runtime.doc, state);
  for (const hook of afterCommit) hook(commit, state);
}

export function getConsent(): ConsentState | null {
  return runtime ? copy(runtime.store.state()) : null;
}

export function onConsent(listener: ConsentListener): () => void {
  const subscription = { listener };
  listeners.add(subscription);
  if (runtime) safeCall(listener, copy(runtime.store.state()));
  return () => void listeners.delete(subscription);
}

export function openSettings(): void {
  runtime?.ui?.openSettings();
}

export function withdraw(): void {
  if (!runtime) return;
  choose(Object.fromEntries(optionalIds(runtime.store.config).map((id) => [id, false])));
}
