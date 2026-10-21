/**
 * Lists the module specifiers a built bundle imports or re-exports. The browser entries must have
 * zero runtime dependencies (plan: Repository layout, Safety), so any non-relative specifier in
 * them is a failure.
 */
export function importSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    // import "x"; import x from "x"; import {a as b} from "x"; export {a} from "x"; export * from "x"
    /\b(?:import|export)\s*(?:[\w$*{},\s]*?\s*from\s*)?["']([^"']+)["']/g,
    // import("x")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1] ?? "");
  }
  return specifiers;
}

export function externalImports(code: string): string[] {
  return importSpecifiers(code).filter((specifier) => !specifier.startsWith("./"));
}
