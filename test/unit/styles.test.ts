import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { DEFAULT_COLORS } from "../../src/astro/theme-defaults";
import { colorVar, THEME_COLORS } from "../../src/core/tokens";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("stylesheet", () => {
  test.each(THEME_COLORS)("the %s default matches the contrast-checked palette", (token) => {
    const match = new RegExp(`${colorVar(token)}:\\s*([^;]+);`).exec(withoutComments);
    expect(match?.[1]).toBe(DEFAULT_COLORS[token]);
  });

  test("every rule is scoped under .consent", () => {
    const selectors = [...withoutComments.matchAll(/(^|})\s*([^{}@]+?)\s*{/g)].map((m) =>
      m[2]!.trim(),
    );
    const outside = selectors
      .flatMap((s) => s.split(",").map((part) => part.trim()))
      .filter((s) => s !== "from" && s !== "to" && !s.startsWith(".consent"));
    expect(outside).toEqual([]);
  });

  test("animations and transitions are disabled under prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)}\s*}/.exec(
      withoutComments,
    );
    expect(block?.[1]).toMatch(/animation: none !important/);
    expect(block?.[1]).toMatch(/transition: none !important/);
  });

  test("the focus ring uses the focus colour and is never removed", () => {
    expect(withoutComments).toMatch(
      /:focus-visible[^{]*{\s*outline: 3px solid var\(--consent-focus\)/,
    );
    expect(withoutComments).not.toMatch(/outline:\s*(none|0)/);
  });

  test("Accept all and Reject all have identical rules apart from their colours", () => {
    const rule = (name: string) =>
      new RegExp(`\\.consent__button--${name} {([^}]*)}`)
        .exec(withoutComments)![1]!
        .replaceAll(name, "X");
    expect(rule("accept")).toBe(rule("reject"));
  });
});
