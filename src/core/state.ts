import type { ConsentConfig } from "../astro/schema";
import { readChoice, writeChoice, type StoredChoice } from "./cookie";
import type { ConsentAction, ConsentState } from "./types";

/** Optional (non-required) category ids, in config order. */
export const optionalIds = (config: ConsentConfig): string[] =>
  config.categories.filter((category) => category.required !== true).map((category) => category.id);

/** Full category map: required categories forced to `true`, optional ones from `optional`. */
export function resolveCategories(
  config: ConsentConfig,
  optional: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const categories: Record<string, boolean> = {};
  for (const category of config.categories) {
    categories[category.id] = category.required === true || optional[category.id] === true;
  }
  return categories;
}

/**
 * The recorded action for a transition (plan: Action semantics), or `null` for a no-op: a valid
 * stored choice exists and the resulting optional state is identical to it.
 */
export function deriveAction(
  config: ConsentConfig,
  before: StoredChoice | null,
  after: Readonly<Record<string, boolean>>,
): ConsentAction | null {
  const ids = optionalIds(config);
  if (before !== null && ids.every((id) => before.c[id] === after[id])) return null;
  if (ids.every((id) => after[id] === true)) return "accept_all";
  if (ids.every((id) => after[id] !== true)) {
    return before !== null && ids.some((id) => before.c[id] === true) ? "withdraw" : "reject_all";
  }
  return "custom";
}

export interface Commit {
  action: ConsentAction;
  choice: StoredChoice;
}

/**
 * The consent state machine for one document. Reading the cookie at construction is its only
 * I/O until `choose` is called with a state-establishing or state-changing choice.
 */
export class ConsentStore {
  readonly config: ConsentConfig;
  /** Resolved locale; re-resolved when a client-side navigation changes `<html lang>`. */
  locale: string;
  private readonly doc: Document;
  private stored: StoredChoice | null;

  constructor(doc: Document, config: ConsentConfig, locale: string) {
    this.doc = doc;
    this.config = config;
    this.locale = locale;
    this.stored = readChoice(doc, config);
  }

  /** The valid stored choice, if any. */
  get choice(): StoredChoice | null {
    return this.stored;
  }

  state(): ConsentState {
    return {
      categories: resolveCategories(this.config, this.stored?.c ?? {}),
      policyVersion: this.config.policyVersion,
      locale: this.locale,
      at: this.stored?.t ?? null,
    };
  }

  /** Applies a choice over the optional categories; returns `null` for a no-op. */
  choose(optional: Readonly<Record<string, boolean>>, now = Date.now()): Commit | null {
    const categories = resolveCategories(this.config, optional);
    const action = deriveAction(this.config, this.stored, categories);
    if (action === null) return null;
    const choice: StoredChoice = {
      v: 1,
      p: this.config.policyVersion,
      t: Math.floor(now / 1000),
      c: categories,
    };
    writeChoice(this.doc, this.config, choice);
    this.stored = choice;
    return { action, choice };
  }
}
