import type { z } from "zod";
import { BUTTONS, colorVar, THEME_COLORS, type ButtonId, type ThemeColor } from "../core/tokens";
import { contrastRatio, parseColor } from "./color";
import { consentConfigSchema, GTAG_CONSENT_KEYS, ID_PATTERN, type ConsentConfig } from "./schema";
import { DEFAULT_COLORS } from "./theme-defaults";

export interface ValidationIssue {
  /** The offending key, e.g. `locales.sv.categories.ads`. Empty for the root. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; config: ConsentConfig; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

/**
 * Keys that later versions add (plan: Version boundary), so an older package names the version
 * to upgrade to. Empty while every planned key exists; `gpc` joins it when that key is scheduled.
 */
const LATER_KEYS: Record<string, string> = {};

/** Minimum WCAG 2.1 AA contrast for normal text. */
const MIN_CONTRAST = 4.5;

const CONTRAST_PAIRS: Array<[ThemeColor, ThemeColor]> = [
  ["text", "background"],
  ["acceptText", "acceptBackground"],
  ["rejectText", "rejectBackground"],
  ["settingsText", "settingsBackground"],
  ["saveText", "saveBackground"],
];

const LINK_TOKEN = /\{link:([^}]*)\}/g;

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

function schemaIssues(error: z.ZodError): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const path = formatPath([...issue.path, key]);
        const later = issue.path.length === 0 ? LATER_KEYS[key] : undefined;
        issues.push({
          path,
          message:
            later === undefined
              ? "unknown key"
              : `unknown key: \`${key}\` is added in @edgesweden/consent ${later}; upgrade to use it`,
        });
      }
    } else {
      issues.push({ path: formatPath(issue.path), message: issue.message });
    }
  }
  return issues;
}

/** The resolved button set: Settings is dropped when `buttons.settings` is `false`. */
const buttonSet = (settings: boolean | undefined): ButtonId[] =>
  BUTTONS.filter((button) => settings !== false || button !== "settings");

/** ASCII control characters (and optionally space): URL parsers strip or reinterpret these. */
const hasControlChars = (value: string, includingSpace = false): boolean =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f || (includingSpace && code === 0x20);
  });

/** Origin used to resolve relative URLs when checking where they lead. */
const PROBE_ORIGIN = "https://probe.invalid";

/** A root-relative path that stays on the site's origin, or an absolute http(s) URL. */
function isAllowedRecordUrl(url: string): boolean {
  if (url === "" || url.includes("\\") || hasControlChars(url, true)) return false;
  let resolved: URL;
  try {
    resolved = new URL(url, `${PROBE_ORIGIN}/`);
  } catch {
    return false;
  }
  if (url.startsWith("/")) return resolved.origin === PROBE_ORIGIN;
  return /^https?:\/\/[^/]/i.test(url) && ["http:", "https:"].includes(resolved.protocol);
}

/** Link hrefs may be relative or use http(s), mailto or tel; script-capable schemes fail. */
function isAllowedHref(href: string): boolean {
  if (hasControlChars(href)) return false;
  try {
    const { protocol } = new URL(href, `${PROBE_ORIGIN}/`);
    return ["http:", "https:", "mailto:", "tel:"].includes(protocol);
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLabel = (value: unknown): value is string => typeof value === "string" && value !== "";

const objectAt = (value: unknown): Json => (isObject(value) ? value : {});

/**
 * Validates a consent config (plan: Validation). Every failure names the offending key.
 * Contrast failures are warnings unless `validation.strictContrast` is `true`.
 *
 * The schema and the cross-field rules run in one pass: the cross-field rules read the raw
 * input defensively and use each part only when that part is itself well-formed, so an
 * unrelated schema error never hides them, and a malformed part is reported once, by the
 * schema, rather than again by a rule that depends on it.
 */
export function validateConfig(input: unknown): ValidationResult {
  const parsed = consentConfigSchema.safeParse(input);
  const errors: ValidationIssue[] = parsed.success ? [] : schemaIssues(parsed.error);
  const warnings: ValidationIssue[] = [];
  crossFieldIssues(objectAt(input), errors, warnings);
  return parsed.success && errors.length === 0
    ? { ok: true, config: parsed.data, warnings }
    : { ok: false, errors, warnings };
}

function crossFieldIssues(raw: Json, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  const fail = (path: string, message: string): void => void errors.push({ path, message });

  // Ids: unique categories, unique services across all categories, at least one optional. Only
  // well-formed ids are used, so other errors inside a category do not hide the locale checks.
  // An empty or non-array list is the schema's to report; the id-dependent checks then skip.
  const rawCategories =
    Array.isArray(raw["categories"]) && raw["categories"].length > 0
      ? raw["categories"]
      : undefined;
  // A malformed id is reported by the schema; its locale strings would otherwise look like strays.
  let malformedId = false;
  const categoryIds = new Set<string>();
  const serviceIds = new Set<string>();
  const isId = (value: unknown): value is string =>
    typeof value === "string" && ID_PATTERN.test(value);
  rawCategories?.forEach((category: unknown, i) => {
    if (!isObject(category)) {
      malformedId = true;
      return;
    }
    if (!isId(category["id"])) malformedId = true;
    else {
      if (categoryIds.has(category["id"]))
        fail(`categories[${i}].id`, `duplicate category id "${category["id"]}"`);
      categoryIds.add(category["id"]);
    }
    if (category["services"] === undefined) return;
    if (!Array.isArray(category["services"])) {
      malformedId = true;
      return;
    }
    category["services"].forEach((service: unknown, j) => {
      if (!isObject(service) || !isId(service["id"])) {
        malformedId = true;
        return;
      }
      if (serviceIds.has(service["id"])) {
        fail(`categories[${i}].services[${j}].id`, `duplicate service id "${service["id"]}"`);
      }
      serviceIds.add(service["id"]);
    });
  });
  if (
    rawCategories !== undefined &&
    rawCategories.every((category) => isObject(category) && category["required"] === true)
  ) {
    fail(
      "categories",
      "at least one optional (non-required) category is required; there is nothing to consent to",
    );
  }

  // Locales.
  const locales = isObject(raw["locales"]) ? raw["locales"] : undefined;
  if (locales !== undefined) {
    for (const key of ["defaultLocale", "locale"] as const) {
      const value = raw[key];
      if (isLabel(value) && !Object.hasOwn(locales, value)) {
        fail(key, `"${value}" is not a key of locales`);
      }
    }
  }
  for (const [code, value] of Object.entries(locales ?? {})) {
    if (!isObject(value)) continue;
    const strings = value;
    const base = `locales.${code}`;
    if (
      typeof strings["title"] === "string" &&
      strings["title"].trim() === "" &&
      strings["dialogLabel"] === undefined
    ) {
      fail(
        `${base}.title`,
        "an empty title needs dialogLabel so the dialog has an accessible name",
      );
    }
    if (rawCategories !== undefined) {
      const sections = [
        ["categories", "category", categoryIds, strings["categories"]],
        ["services", "service", serviceIds, strings["services"] ?? {}],
      ] as const;
      for (const [key, noun, ids, present] of sections) {
        if (!isObject(present)) continue; // the schema reports it
        for (const id of ids) {
          if (!Object.hasOwn(present, id)) {
            fail(`${base}.${key}.${id}`, `missing strings for ${noun} "${id}"`);
          }
        }
        if (malformedId) continue;
        for (const id of Object.keys(present)) {
          if (!ids.has(id)) fail(`${base}.${key}.${id}`, `no ${noun} with id "${id}"`);
        }
      }
    }

    const links = strings["links"] ?? [];
    if (!Array.isArray(links)) continue; // the schema reports it; tokens cannot be resolved
    const linkIds = new Set<string>();
    // A link without a usable id is the schema's to report; its tokens are then not checked.
    let resolvable = true;
    links.forEach((link: unknown, i) => {
      if (!isObject(link)) {
        resolvable = false;
        return;
      }
      if (isLabel(link["href"]) && !isAllowedHref(link["href"])) {
        fail(`${base}.links[${i}].href`, "must be relative or use http, https, mailto or tel");
      }
      if (!isLabel(link["id"])) {
        resolvable = false;
        return;
      }
      if (linkIds.has(link["id"]))
        fail(`${base}.links[${i}].id`, `duplicate link id "${link["id"]}"`);
      linkIds.add(link["id"]);
    });
    for (const field of ["description", "settingsDescription"] as const) {
      const text = strings[field];
      if (!resolvable || typeof text !== "string") continue;
      for (const match of text.matchAll(LINK_TOKEN)) {
        const linkId = match[1] ?? "";
        if (!linkIds.has(linkId)) {
          fail(`${base}.${field}`, `{link:${linkId}} matches no entry in ${base}.links`);
        }
      }
    }
  }

  // Buttons: an exact permutation of the resolved set.
  const buttons = objectAt(raw["buttons"]);
  const settings = buttons["settings"];
  const order = buttons["order"];
  if (
    (settings === undefined || typeof settings === "boolean") &&
    Array.isArray(order) &&
    order.every((button) => (BUTTONS as readonly unknown[]).includes(button))
  ) {
    const expected = buttonSet(settings);
    const sorted = (list: readonly unknown[]): string => [...list].map(String).sort().join(",");
    if (sorted(order) !== sorted(expected)) {
      fail(
        "buttons.order",
        `must list exactly ${expected.map((b) => `"${b}"`).join(", ")} once each` +
          (settings === false ? ' ("settings" is disabled by buttons.settings)' : ""),
      );
    }
  }

  // Layout.
  const layout = objectAt(raw["layout"]);
  const backdrop = layout["backdrop"] ?? "dim";
  const blocking = layout["blocking"] ?? true;
  if (blocking === true && backdrop === "none") {
    fail(
      layout["blocking"] === undefined ? "layout.backdrop" : "layout.blocking",
      'blocking mode (the default) requires layout.backdrop "dim"; set layout.blocking to false for backdrop "none"',
    );
  }

  // Theme colours: parse, then contrast over the default palette.
  const theme = objectAt(raw["theme"]);
  const rawColors = objectAt(theme["colors"]);
  const colors: Partial<Record<ThemeColor, string>> = {};
  let colorsParse = true;
  for (const token of THEME_COLORS) {
    const value = rawColors[token];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      colorsParse = false; // reported by the schema; contrast is not checked against a default
    } else if (parseColor(value) === null) {
      colorsParse = false;
      fail(`theme.colors.${token}`, `"${value}" is not a supported CSS colour`);
    } else colors[token] = value;
  }
  if (colorsParse) {
    const strict = objectAt(raw["validation"])["strictContrast"] === true;
    for (const [fg, bg] of CONTRAST_PAIRS) {
      if (colors[fg] === undefined && colors[bg] === undefined) continue;
      const fgColor = parseColor(colors[fg] ?? DEFAULT_COLORS[fg]);
      const bgColor = parseColor(colors[bg] ?? DEFAULT_COLORS[bg]);
      if (fgColor === null || bgColor === null) continue;
      const ratio = contrastRatio(fgColor, bgColor);
      if (ratio < MIN_CONTRAST) {
        const issue = {
          path: `theme.colors.${colors[fg] !== undefined ? fg : bg}`,
          message: `contrast of ${fg} on ${bg} is ${ratio.toFixed(2)}:1; at least ${MIN_CONTRAST}:1 is required`,
        };
        (strict ? errors : warnings).push(issue);
      }
    }
  }
  const colorVars = new Set(THEME_COLORS.map(colorVar));
  for (const key of Object.keys(objectAt(theme["vars"]))) {
    if (colorVars.has(key)) {
      fail(
        `theme.vars.${key}`,
        "names a theme colour token; set it through theme.colors so contrast is checked",
      );
    }
  }

  // Consent Mode: mapped categories exist; each gtag key has exactly one owner.
  const consentMode = objectAt(raw["consentMode"]);
  const isGtagKey = (key: unknown): key is string =>
    (GTAG_CONSENT_KEYS as readonly unknown[]).includes(key);
  const owner = new Map<string, string>();
  for (const [categoryId, keys] of Object.entries(objectAt(consentMode["mapping"]))) {
    const path = `consentMode.mapping.${categoryId}`;
    if (rawCategories !== undefined && !malformedId && !categoryIds.has(categoryId)) {
      fail(path, `no category with id "${categoryId}"`);
    }
    if (!Array.isArray(keys)) continue;
    keys.forEach((key: unknown, i) => {
      if (!isGtagKey(key)) return;
      const previous = owner.get(key);
      if (previous !== undefined) {
        fail(
          `${path}[${i}]`,
          `"${key}" is already mapped by ${previous}; each key belongs to one category`,
        );
      }
      owner.set(key, path);
    });
  }
  for (const key of Object.keys(objectAt(consentMode["extra"]))) {
    const previous = owner.get(key);
    if (previous !== undefined) {
      fail(
        `consentMode.extra.${key}`,
        `"${key}" is already mapped by ${previous}; a key is either mapped or extra`,
      );
    }
  }

  // Record URL.
  if (typeof raw["record"] === "string" && !isAllowedRecordUrl(raw["record"])) {
    fail("record", "must be a root-relative path (/…) or an absolute http(s) URL");
  }
}
