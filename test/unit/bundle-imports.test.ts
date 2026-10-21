import { describe, expect, test } from "vitest";
import { externalImports } from "../../scripts/lib/bundle-imports.ts";

describe("externalImports", () => {
  test("accepts a bundle whose only import is its own stylesheet", () => {
    expect(externalImports(`import"./styles.css";var a=1;export{a as mount};`)).toEqual([]);
  });
  test.each([
    [`import{z as o}from"zod";`, "zod"],
    [`import o from "astro";`, "astro"],
    [`import * as o from 'zod';`, "zod"],
    [`import"zod";`, "zod"],
    [`export{z}from"zod";`, "zod"],
    [`export*from"zod";`, "zod"],
    [`const m=import("zod");`, "zod"],
    [`import{a}from"../src/astro/schema.js";`, "../src/astro/schema.js"],
  ])("flags %s", (code, specifier) => {
    expect(externalImports(`import"./styles.css";${code}`)).toEqual([specifier]);
  });
});
