import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

// The CSP bans (plan: CSP) are enforced by check:lint; this proves each rule actually fires on
// browser-bundle paths and stays out of the build-time ./astro code.
const eslint = new ESLint();

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? "fatal");
}

const banned: Array<[string, string]> = [
  ["innerHTML", `export const f = (el: HTMLElement) => { el.innerHTML = "x"; };`],
  ["outerHTML", `export const f = (el: HTMLElement) => { el.outerHTML = "x"; };`],
  [
    "insertAdjacentHTML",
    `export const f = (el: HTMLElement) => el.insertAdjacentHTML("afterend", "x");`,
  ],
  ["setAttribute style", `export const f = (el: HTMLElement) => el.setAttribute("style", "x");`],
  ["setAttribute STYLE", `export const f = (el: HTMLElement) => el.setAttribute("STYLE", "x");`],
  ["setAttribute `style`", "export const f = (el: HTMLElement) => el.setAttribute(`style`, 'x');"],
  [
    "setAttributeNS style",
    `export const f = (el: HTMLElement) => el.setAttributeNS(null, "style", "x");`,
  ],
  ["setHTMLUnsafe", `export const f = (el: any) => el.setHTMLUnsafe("x");`],
  ["DOMParser", `export const f = () => new DOMParser();`],
  ["parseFromString", `export const f = (p: any) => p.parseFromString("x", "text/html");`],
  ["srcdoc", `export const f = (el: any) => { el.srcdoc = "x"; };`],
  ["setTimeout string", `export const f = () => setTimeout("x()", 1);`],
  ["cssText", `export const f = (el: HTMLElement) => { el.style.cssText = "x"; };`],
  ["style assignment", `export const f = (el: any) => { el.style = "x"; };`],
  ["<style> element", `export const f = (d: Document) => d.createElement("style");`],
  ["<STYLE> element", `export const f = (d: Document) => d.createElement("STYLE");`],
  ["eval", `export const f = () => eval("1");`],
  ["new Function", `export const f = () => new Function("return 1");`],
  ["document.write", `export const f = (d: Document) => d.write("x");`],
  ["zod value import", `import { z } from "zod"; export const s = z.string();`],
  [
    "astro code import",
    `import { validateConfig } from "../astro/validate"; export const v = validateConfig;`,
  ],
];

describe("CSP lint bans", () => {
  for (const dir of ["core", "gate", "gtag"]) {
    test.each(banned)(`src/${dir}: %s is an error`, async (_name, code) => {
      expect(await ruleIds(code, `src/${dir}/probe.ts`)).not.toEqual([]);
    });
  }

  test("type-only imports from zod and ./astro are allowed in the core", async () => {
    const code = `import type { ZodType } from "zod";\nimport type { X } from "../astro/schema";\nexport type Y = ZodType | X;\n`;
    expect(await ruleIds(code, "src/core/probe.ts")).toEqual([]);
  });

  test("ordinary attributes, elements and timers are allowed in the core", async () => {
    const code = `export const f = (d: Document) => { const el = d.createElement("div"); el.setAttribute("role", "dialog"); setTimeout(() => el.remove(), 1); };\n`;
    expect(await ruleIds(code, "src/core/probe.ts")).toEqual([]);
  });

  test("style.setProperty is allowed in the core", async () => {
    const code = `export const f = (el: HTMLElement) => el.style.setProperty("--consent-x", "1");\n`;
    expect(await ruleIds(code, "src/core/probe.ts")).toEqual([]);
  });

  test("the build-time ./astro code may import zod", async () => {
    const code = `import { z } from "zod";\nexport const s = z.string();\n`;
    expect(await ruleIds(code, "src/astro/probe.ts")).toEqual([]);
  });
});
