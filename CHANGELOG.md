# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Continuous integration: every push and pull request runs the full check gate, including
  the end-to-end suite, on GitHub Actions.
- Releases are published from version tags by a GitHub Actions workflow that stages the
  package on npm with provenance; a maintainer approves each version with 2FA before it is
  installable. `docs/releasing.md` describes the procedure.

### Changed

- Package metadata (`repository`, `homepage`, `bugs`) points at the public repository
  `EdgeSweden/theconsent`.

## [0.2.2] - 2026-10-20

### Fixed

- Script gating no longer adds an `async` attribute to classic scripts that did not have one
  (v0.2.1 did, which `document.currentScript.async` exposed). Only a module without `async` is
  changed, to `async = false`.
- Documentation: the README names `data-astro-exec` as the one attribute a gated script gains,
  and the 0.2.1 entry below now says "modules without `async`" instead of "modules always".

## [0.2.1] - 2026-10-20

### Fixed

- Astro's ClientRouter: after a client-side navigation the banner and settings dialog are
  re-attached to the new page in its language, the `data-consent-<id>` attributes are re-applied,
  and script gating activates the new page's placeholders once the router has finished the page.
  An external gated script URL is now loaded at most once per document, even if several
  placeholders name it. Previously the UI vanished and could not be reopened.
- The `./gate` and `./gtag` typings no longer import `./astro.js`, so TypeScript projects without
  Astro can use them (previously `Cannot find module 'astro'`).
- Script gating documents its real ordering: classic scripts in page order, modules in page order
  among themselves, as without gating (modules are deferred). Modules without `async` are
  inserted with `async = false` and never block later scripts, and `nomodule` now applies to
  classic scripts only.

## [0.2.0] - 2026-10-20

Adds the two optional adapters. Both keys join config schema version 1 additively, so every
v0.1 config stays valid, and neither adapter does anything unless its key is set.

### Added

- Script gating: the `gateScripts` config key (default `false`) and the
  `@edgesweden/consent/gate` entry. `installScriptGating(config)` turns each
  `<script type="text/plain" data-consent="<id>">` into a live script, once, when its category is
  granted; required categories run at mount. Activated scripts run in page order (an external
  script without `async` holds up the ones after it until it loads or fails; scripts the browser
  skips, such as `nomodule`, do not), and a gate installed before the body is parsed takes a
  second pass at `DOMContentLoaded`. Budget: 1 kB gzipped.
- Google Consent Mode v2: the `consentMode` config key (`mapping` from category id to gtag keys,
  optional `extra`) and the `@edgesweden/consent/gtag` entry. `installConsentMode(config)` pushes
  `gtag("consent", "default", …)` with optional keys denied and required keys granted, then
  `gtag("consent", "update", …)` whenever the mapped values change, through `window.dataLayer`.
  Each gtag key belongs to one category, which validation enforces. Budget: 1 kB gzipped.
- The Astro integration generates its page script per config: it imports and installs `./gate`
  when `gateScripts` is `true` and `./gtag` when `consentMode` is set, after `mount`.
- The demo gates one local script per category and shows the Consent Mode `dataLayer` entries;
  the e2e suite covers both adapters.

### Changed

- `pageScript` from `@edgesweden/consent/astro` (an undocumented helper) now takes the config:
  `pageScript(config)`.

## [0.1.0] - 2026-10-20

First release. The core and its stylesheet are 5.64 kB gzipped against the 6 kB budget, with zero
runtime dependencies in the browser entry.

### Added

- Config schema version 1 (zod) with TypeScript types derived from it, and `validateConfig`,
  exported from `@edgesweden/consent/astro`. Every failure names the offending key; contrast
  failures are warnings unless `validation.strictContrast` is `true`.
- `mount(config, document?)`, `getConsent()`, `onConsent(cb)`, `withdraw()` and `openSettings()`;
  the `consent` cookie (URL-encoded JSON, `SameSite=Lax`, `Secure` on https); the
  `consent:change` event, `data-consent-<id>` attributes on `<html>` and click delegation for any
  `data-consent="open"` element; locale resolution from
  `config.locale`, `<html lang>`, the language without region, then `defaultLocale`.
- The banner and the settings dialog: Accept all and Reject all always on the first layer with
  equal styling, an optional Settings button and `buttons.order`; one switch per optional
  category with required categories locked on; blocking mode (no dismissal, inert page, focus
  trap) and non-blocking mode (a close control that stores nothing); every `layout.position`;
  dialog semantics, focus management and reduced-motion support; the bundled `styles.css`.
- Theming through `theme.colors`, `theme.radius`, `theme.font`, `theme.zIndex`, `theme.vars` and
  `layout.width`, each applied as a `--consent-*` custom property with `style.setProperty`; policy
  links through `{link:<id>}` tokens in `description` and `settingsDescription`.
- The `record` hook: a function receives an identifier-free `ConsentRecord` after each
  state-establishing or state-changing choice; a URL receives the same object as JSON via
  `sendBeacon`, falling back to `fetch` with `keepalive`. Failures never reach the visitor.
- The Astro integration `@edgesweden/consent/astro`: validates the config at build time and fails
  the build with every offending key, logs contrast warnings, exposes the config through a virtual
  module and injects one page script that calls `mount` plus the stylesheet.
- A neutral bilingual Astro demo under `examples/astro` (strict CSP, record list, reopen and
  withdraw controls) and a Playwright + axe suite against it.
- Size budget: the core including its stylesheet is at most 6 kB gzipped, enforced by `pnpm size`.
