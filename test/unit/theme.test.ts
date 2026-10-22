import { afterEach, describe, expect, test, vi } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { baseConfig } from "./fixtures";
import { COLOR_VAR } from "../../src/core/theme";
import { colorVar, THEME_COLORS } from "../../src/core/tokens";
import { harness } from "./helpers";

async function themed(extra: Partial<ConsentConfig>) {
  const h = await harness();
  const style = h.window.CSSStyleDeclaration.prototype;
  const setProperty = vi.spyOn(style, "setProperty");
  // Record who called setAttribute: happy-dom itself serialises setProperty into the style
  // attribute (as browsers do), so only calls made directly from package code count. A plain
  // patch (not a spy) keeps the direct caller at a fixed stack depth.
  const elementProto = h.window.Element.prototype;
  const originalSetAttribute = elementProto.setAttribute;
  const styleAttributeWritesFromPackage: string[] = [];
  elementProto.setAttribute = function (this: Element, name: string, value: string) {
    const caller = new Error().stack?.split("\n")[2] ?? "";
    if (name.toLowerCase() === "style" && caller.includes("/src/")) {
      styleAttributeWritesFromPackage.push(caller);
    }
    return originalSetAttribute.call(this, name, value);
  };
  const cssText = Object.getOwnPropertyDescriptor(style, "cssText");
  const cssTextSet = vi.fn();
  Object.defineProperty(style, "cssText", {
    configurable: true,
    get() {
      return cssText?.get?.call(this);
    },
    set(value: string) {
      cssTextSet(value);
      cssText?.set?.call(this, value);
    },
  });
  try {
    h.api.mount({ ...baseConfig(), ...extra }, h.doc);
  } finally {
    if (cssText) Object.defineProperty(style, "cssText", cssText);
    elementProto.setAttribute = originalSetAttribute;
  }
  const root = h.doc.querySelector<HTMLElement>(".consent")!;
  const props = Object.fromEntries(
    setProperty.mock.calls.map(([name, value]) => [name as string, value as string]),
  );
  return { ...h, root, props, setProperty, styleAttributeWritesFromPackage, cssTextSet };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme", () => {
  test("vars outside --consent-* or naming a colour token are skipped at runtime", async () => {
    const t = await themed({
      theme: {
        vars: {
          "--consent-gap": "2rem",
          "--consent-text": "#ccc",
          "--consent-accept-background": "#eee",
          "--other": "1px",
        } as Record<`--consent-${string}`, string>,
      },
    });
    expect(t.props["--consent-gap"]).toBe("2rem");
    expect(t.setProperty.mock.calls.map(([name]) => name)).not.toEqual(
      expect.arrayContaining(["--consent-text"]),
    );
    expect(Object.keys(t.props)).not.toContain("--consent-accept-background");
    expect(Object.keys(t.props)).not.toContain("--other");
  });
  test("COLOR_VAR matches exactly the colour tokens' custom properties", () => {
    for (const token of THEME_COLORS) expect(COLOR_VAR.test(colorVar(token)), token).toBe(true);
    for (const name of [
      "--consent-gap",
      "--consent-width",
      "--consent-text-x",
      "--consent-toggle",
      "--consent-accept",
    ]) {
      expect(COLOR_VAR.test(name), name).toBe(false);
    }
    // Every alternative the pattern allows is a token: count the names it can match.
    const names = ["background", "text", "muted", "link", "border", "backdrop", "focus"]
      .concat(
        ["accept", "reject", "settings", "save"].flatMap((b) => [`${b}-background`, `${b}-text`]),
      )
      .concat(["on", "off", "knob"].map((s) => `toggle-${s}`));
    expect(names.map((n) => `--consent-${n}`).sort()).toEqual(THEME_COLORS.map(colorVar).sort());
  });

  test("colours become --consent-* custom properties on the root via setProperty", async () => {
    const t = await themed({
      theme: { colors: { background: "#000", text: "#fff", acceptBackground: "rebeccapurple" } },
    });
    expect(t.props).toMatchObject({
      "--consent-background": "#000",
      "--consent-text": "#fff",
      "--consent-accept-background": "rebeccapurple",
    });
    expect(t.root.style.getPropertyValue("--consent-accept-background")).toBe("rebeccapurple");
    expect([...t.doc.querySelectorAll("[style]")]).toEqual([t.root]);
  });
  test("radius, font, zIndex, width and vars are applied", async () => {
    const t = await themed({
      theme: {
        radius: { box: "0", button: "2px", control: "4px" },
        font: "system-ui, sans-serif",
        zIndex: 10,
        vars: { "--consent-gap": "2rem" },
      },
      layout: { width: "30rem" },
    });
    expect(t.props).toEqual({
      "--consent-radius-box": "0",
      "--consent-radius-button": "2px",
      "--consent-radius-control": "4px",
      "--consent-font": "system-ui, sans-serif",
      "--consent-z": "10",
      "--consent-width": "30rem",
      "--consent-gap": "2rem",
    });
  });
  test("no theme sets no inline property", async () => {
    const t = await themed({});
    expect(t.setProperty).not.toHaveBeenCalled();
  });
  test("setAttribute('style') and style.cssText are never used", async () => {
    const t = await themed({
      theme: { colors: { text: "#000" }, zIndex: 1, vars: { "--consent-gap": "1px" } },
    });
    expect(t.setProperty).toHaveBeenCalled();
    expect(t.styleAttributeWritesFromPackage).toEqual([]);
    expect(t.cssTextSet).not.toHaveBeenCalled();
  });
  test("no <style> element is created", async () => {
    const t = await themed({ theme: { colors: { text: "#000" } } });
    expect(t.doc.querySelectorAll("style")).toHaveLength(0);
  });
});
