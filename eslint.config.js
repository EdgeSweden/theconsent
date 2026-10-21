import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Browser bundles must stay strict-CSP clean (plan: Principles 3, CSP): no HTML strings, no
 * style attribute or <style> injection, no dynamic code. These rules hold that line.
 */
const cspRestrictedProperties = [
  ["innerHTML", "Build DOM nodes; HTML strings are banned by the CSP rules."],
  ["outerHTML", "Build DOM nodes; HTML strings are banned by the CSP rules."],
  ["insertAdjacentHTML", "Build DOM nodes; HTML strings are banned by the CSP rules."],
  ["cssText", "Apply theme values one at a time with style.setProperty."],
  ["write", "document.write is banned by the CSP rules."],
  ["writeln", "document.writeln is banned by the CSP rules."],
  ["createContextualFragment", "HTML strings are banned by the CSP rules."],
  ["setHTMLUnsafe", "HTML strings are banned by the CSP rules."],
  ["parseHTMLUnsafe", "HTML strings are banned by the CSP rules."],
  ["parseFromString", "HTML strings are banned by the CSP rules."],
  ["srcdoc", "HTML strings are banned by the CSP rules."],
].map(([property, message]) => ({ property, message }));

const cspRestrictedSyntax = [
  {
    selector: `CallExpression[callee.property.name=/^(setAttribute|toggleAttribute)$/] > :matches(Literal[value=/^style$/i], TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^style$/i]).arguments:first-child`,
    message: "Do not set the style attribute; use style.setProperty for each custom property.",
  },
  {
    selector: `CallExpression[callee.property.name='setAttributeNS'] > :matches(Literal[value=/^style$/i], TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^style$/i]).arguments:nth-child(2)`,
    message: "Do not set the style attribute; use style.setProperty for each custom property.",
  },
  {
    selector: `CallExpression[callee.property.name=/^createElement(NS)?$/] > :matches(Literal[value=/^style$/i], TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^style$/i])`,
    message: "Do not inject <style> elements; the stylesheet ships as a bundled asset.",
  },
  {
    selector: "AssignmentExpression[left.property.name='style']",
    message: "Do not assign element.style; use style.setProperty for each custom property.",
  },
  {
    selector: "NewExpression[callee.name='DOMParser']",
    message: "HTML strings are banned by the CSP rules.",
  },
  {
    selector:
      "CallExpression[callee.name=/^set(Timeout|Interval)$/] > :matches(Literal, TemplateLiteral).arguments:first-child",
    message: "String arguments to setTimeout/setInterval are eval.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      ".astro/",
      "examples/*/dist/",
      "examples/*/dist-nonblocking/",
      "examples/*/dist-router/",
      "examples/*/.astro/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["src/core/**", "src/gate/**", "src/gtag/**"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-restricted-properties": ["error", ...cspRestrictedProperties],
      "no-restricted-syntax": ["error", ...cspRestrictedSyntax],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "zod",
              message: "zod is build-time only (plan: Safety).",
              allowTypeImports: true,
            },
            {
              name: "astro",
              message: "Astro is imported only by ./astro (plan: Safety).",
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: ["**/astro/**", "**/astro"],
              message: "Browser entries may import only types from the build-time ./astro code.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  prettier,
);
