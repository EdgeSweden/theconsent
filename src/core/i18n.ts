import type { ConsentConfig } from "../astro/schema";

/**
 * Resolved locale key (plan: Locale resolution): `config.locale` → `<html lang>` → `lang` without
 * region (`sv-SE` → `sv`) → `defaultLocale`. Matching is case-insensitive; the result is always a
 * key of `config.locales`.
 */
export function resolveLocale(config: ConsentConfig, doc: Document): string {
  const keys = Object.keys(config.locales);
  const find = (tag: string | undefined): string | undefined => {
    if (!tag) return undefined;
    const lower = tag.trim().toLowerCase();
    return keys.find((key) => key === tag) ?? keys.find((key) => key.toLowerCase() === lower);
  };
  const lang = doc.documentElement.lang;
  return find(config.locale) ?? find(lang) ?? find(lang.split("-")[0]) ?? config.defaultLocale;
}

const LINK_TOKEN = /\{link:([^}]*)\}/;

/**
 * Renders plain text with `{link:<id>}` tokens as text nodes and `<a>` elements (plan: Locale
 * resolution). Strings are never parsed as HTML.
 */
export function renderText(
  doc: Document,
  text: string,
  links: ReadonlyArray<{ id: string; label: string; href: string }> = [],
): Array<Node | string> {
  // split() with one capture group alternates text and link ids: [text, id, text, id, text…]
  return text.split(new RegExp(LINK_TOKEN, "g")).map((part, index) => {
    if (index % 2 === 0) return part;
    const link = links.find((candidate) => candidate.id === part);
    if (link === undefined) return `{link:${part}}`;
    const anchor = doc.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    return anchor;
  });
}
