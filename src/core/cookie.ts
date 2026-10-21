import type { ConsentConfig } from "../astro/schema";
import { DEFAULT_COOKIE_NAME, DEFAULT_MAX_AGE_DAYS } from "./tokens";

/** The stored choice (plan: Cookie). */
export interface StoredChoice {
  v: 1;
  /** policyVersion the choice was made under. */
  p: string;
  /** Unix seconds. */
  t: number;
  /** Every category id → granted. */
  c: Record<string, boolean>;
}

export const cookieName = (config: ConsentConfig): string =>
  config.cookie?.name ?? DEFAULT_COOKIE_NAME;

export function encodeChoice(choice: StoredChoice): string {
  return encodeURIComponent(JSON.stringify({ v: choice.v, p: choice.p, t: choice.t, c: choice.c }));
}

/** Decodes a cookie value; anything that is not a well-formed v1 choice is `null`. */
export function decodeChoice(raw: string): StoredChoice | null {
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { v, p, t, c } = value as Record<string, unknown>;
  if (v !== 1 || typeof p !== "string" || typeof t !== "number" || !Number.isFinite(t)) return null;
  if (typeof c !== "object" || c === null || Array.isArray(c)) return null;
  const categories: Record<string, boolean> = {};
  for (const [id, granted] of Object.entries(c)) {
    if (typeof granted !== "boolean") return null;
    categories[id] = granted;
  }
  return { v: 1, p, t, c: categories };
}

/**
 * Raw values of every cookie named `name`. A browser can hold several (e.g. an old one left on
 * another path or domain after `cookie.path` or `cookie.domain` changed).
 */
export function readCookies(doc: Document, name: string): string[] {
  const values: string[] = [];
  for (const part of doc.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) values.push(part.slice(index + 1).trim());
  }
  return values;
}

/**
 * A stored choice that matches the config: same policyVersion, exactly the configured category
 * set, and every required category granted. Anything else means no consent (plan: Mount).
 */
export function isCurrent(choice: StoredChoice, config: ConsentConfig): boolean {
  if (choice.p !== config.policyVersion) return false;
  const ids = Object.keys(choice.c);
  if (ids.length !== config.categories.length) return false;
  return config.categories.every(
    (category) =>
      Object.hasOwn(choice.c, category.id) &&
      (category.required !== true || choice.c[category.id] === true),
  );
}

/** The newest current choice among the cookies with the configured name, or `null`. */
export function readChoice(doc: Document, config: ConsentConfig): StoredChoice | null {
  let best: StoredChoice | null = null;
  for (const raw of readCookies(doc, cookieName(config))) {
    const choice = decodeChoice(raw);
    if (choice !== null && isCurrent(choice, config) && (best === null || choice.t > best.t)) {
      best = choice;
    }
  }
  return best;
}

/** The full `Set-Cookie`-style string written to `document.cookie`. */
export function serializeCookie(
  config: ConsentConfig,
  choice: StoredChoice,
  secure: boolean,
): string {
  const days = config.cookie?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const parts = [
    `${cookieName(config)}=${encodeChoice(choice)}`,
    `Max-Age=${Math.round(days * 86400)}`,
    `Path=${config.cookie?.path ?? "/"}`,
    "SameSite=Lax",
  ];
  if (config.cookie?.domain !== undefined) parts.push(`Domain=${config.cookie.domain}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function writeChoice(doc: Document, config: ConsentConfig, choice: StoredChoice): void {
  const secure = doc.defaultView?.location.protocol === "https:";
  doc.cookie = serializeCookie(config, choice, secure);
}
