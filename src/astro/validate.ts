import type { z } from "zod";
import { BUTTONS, colorVar, THEME_COLORS, type ButtonId, type ThemeColor } from "../core/tokens";
import { contrastRatio, parseColor } from "./color";
import { consentConfigSchema, type ConsentConfig } from "./schema";
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

/**
 * Validates a consent config (plan: Validation). Every failure names the offending key.
 * Contrast failures are warnings unless `validation.strictContrast` is `true`.
 */
export function validateConfig(input: unknown): ValidationResult {
  const parsed = consentConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: schemaIssues(parsed.error), warnings: [] };

  const config = parsed.data;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const fail = (path: string, message: string): void => void errors.push({ path, message });

  // Ids: unique categories, unique services across all categories, at least one optional.
  const categoryIds = new Set<string>();
  const serviceIds = new Set<string>();
  config.categories.forEach((category, i) => {
    if (categoryIds.has(category.id))
      fail(`categories[${i}].id`, `duplicate category id "${category.id}"`);
    categoryIds.add(category.id);
    category.services?.forEach((service, j) => {
      if (serviceIds.has(service.id)) {
        fail(`categories[${i}].services[${j}].id`, `duplicate service id "${service.id}"`);
      }
      serviceIds.add(service.id);
    });
  });
  if (!config.categories.some((category) => category.required !== true)) {
    fail(
      "categories",
      "at least one optional (non-required) category is required; there is nothing to consent to",
    );
  }

  // Locales.
  if (!Object.hasOwn(config.locales, config.defaultLocale)) {
    fail("defaultLocale", `"${config.defaultLocale}" is not a key of locales`);
  }
  if (config.locale !== undefined && !Object.hasOwn(config.locales, config.locale)) {
    fail("locale", `"${config.locale}" is not a key of locales`);
  }
  for (const [code, strings] of Object.entries(config.locales)) {
    const base = `locales.${code}`;
    if (strings.title.trim() === "" && strings.dialogLabel === undefined) {
      fail(
        `${base}.title`,
        "an empty title needs dialogLabel so the dialog has an accessible name",
      );
    }
    for (const categoryId of categoryIds) {
      if (!Object.hasOwn(strings.categories, categoryId)) {
        fail(`${base}.categories.${categoryId}`, `missing strings for category "${categoryId}"`);
      }
    }
    for (const key of Object.keys(strings.categories)) {
      if (!categoryIds.has(key)) fail(`${base}.categories.${key}`, `no category with id "${key}"`);
    }
    const services = strings.services ?? {};
    for (const serviceId of serviceIds) {
      if (!Object.hasOwn(services, serviceId)) {
        fail(`${base}.services.${serviceId}`, `missing strings for service "${serviceId}"`);
      }
    }
    for (const key of Object.keys(services)) {
      if (!serviceIds.has(key)) fail(`${base}.services.${key}`, `no service with id "${key}"`);
    }

    const linkIds = new Set<string>();
    strings.links?.forEach((link, i) => {
      if (linkIds.has(link.id)) fail(`${base}.links[${i}].id`, `duplicate link id "${link.id}"`);
      linkIds.add(link.id);
      if (!isAllowedHref(link.href)) {
        fail(`${base}.links[${i}].href`, "must be relative or use http, https, mailto or tel");
      }
    });
    for (const field of ["description", "settingsDescription"] as const) {
      for (const match of (strings[field] ?? "").matchAll(LINK_TOKEN)) {
        const linkId = match[1] ?? "";
        if (!linkIds.has(linkId)) {
          fail(`${base}.${field}`, `{link:${linkId}} matches no entry in ${base}.links`);
        }
      }
    }
  }

  // Buttons: an exact permutation of the resolved set.
  if (config.buttons?.order !== undefined) {
    const expected = buttonSet(config.buttons.settings);
    const order = config.buttons.order;
    const sorted = (list: readonly string[]): string => [...list].sort().join(",");
    if (sorted(order) !== sorted(expected)) {
      fail(
        "buttons.order",
        `must list exactly ${expected.map((b) => `"${b}"`).join(", ")} once each` +
          (config.buttons.settings === false
            ? ' ("settings" is disabled by buttons.settings)'
            : ""),
      );
    }
  }

  // Layout.
  const backdrop = config.layout?.backdrop ?? "dim";
  const blocking = config.layout?.blocking ?? true;
  if (blocking && backdrop !== "dim") {
    fail(
      config.layout?.blocking === undefined ? "layout.backdrop" : "layout.blocking",
      'blocking mode (the default) requires layout.backdrop "dim"; set layout.blocking to false for backdrop "none"',
    );
  }

  // Theme colours: parse, then contrast over the default palette.
  const colors = config.theme?.colors ?? {};
  let colorsParse = true;
  for (const token of THEME_COLORS) {
    const value = colors[token];
    if (value !== undefined && parseColor(value) === null) {
      colorsParse = false;
      fail(`theme.colors.${token}`, `"${value}" is not a supported CSS colour`);
    }
  }
  if (colorsParse) {
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
        (config.validation?.strictContrast === true ? errors : warnings).push(issue);
      }
    }
  }
  const colorVars = new Set(THEME_COLORS.map(colorVar));
  for (const key of Object.keys(config.theme?.vars ?? {})) {
    if (colorVars.has(key)) {
      fail(
        `theme.vars.${key}`,
        "names a theme colour token; set it through theme.colors so contrast is checked",
      );
    }
  }

  // Consent Mode: mapped categories exist; each gtag key has exactly one owner.
  if (config.consentMode !== undefined) {
    const owner = new Map<string, string>();
    for (const [categoryId, keys] of Object.entries(config.consentMode.mapping)) {
      const path = `consentMode.mapping.${categoryId}`;
      if (!categoryIds.has(categoryId)) fail(path, `no category with id "${categoryId}"`);
      keys.forEach((key, i) => {
        const previous = owner.get(key);
        if (previous !== undefined) {
          fail(
            `${path}[${i}]`,
            `"${key}" is already mapped by ${previous}; each key belongs to one category`,
          );
        }
        owner.set(key, `consentMode.mapping.${categoryId}`);
      });
    }
    for (const key of Object.keys(config.consentMode.extra ?? {})) {
      const previous = owner.get(key);
      if (previous !== undefined) {
        fail(
          `consentMode.extra.${key}`,
          `"${key}" is already mapped by ${previous}; a key is either mapped or extra`,
        );
      }
    }
  }

  // Record URL.
  if (typeof config.record === "string" && !isAllowedRecordUrl(config.record)) {
    fail("record", "must be a root-relative path (/…) or an absolute http(s) URL");
  }

  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, config, warnings };
}
