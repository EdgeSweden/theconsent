# @edgesweden/consent — implementation plan

> **Status: ACTIVE (amended 2026-10-21).** Product contract and operating contract of
> `@edgesweden/consent`. The P0–P3 packages were delivered as local, unpublished milestones
> (tags v0.1.0–v0.2.2); from P4 on the package is developed in the public repository
> `EdgeSweden/theconsent`, checked by CI on every push and pull request, and released from
> `vX.Y.Z` tags through a staged, provenance-attested npm publish that a maintainer approves.
> The product contract (Principles through Size budget) is unchanged by that; the Checks,
> Releases and Delivery sections describe the process. `AGENTS.md` points here.

## What this is

A reusable, config-driven cookie-consent banner for static and server-rendered websites:

- a **framework-agnostic core** (vanilla TypeScript + one stylesheet) exposed as `mount(config)`;
- a **thin Astro integration** that validates the config at build time and injects one script;
- two optional **adapters**, each a separate entry point: declarative script gating and a
  Google Consent Mode v2 bridge;
- an optional, identifier-free **consent record** hook (a site-supplied function or URL);
- **no backend** of any kind. Everything is a per-site config file.

Published as the public npm package `@edgesweden/consent` under the MIT licence from the public
repository `EdgeSweden/theconsent`. 0.3.0 is the first version of this codebase on npm (see
Releases). Default cookie name `consent`.

## Principles

1. **Nothing optional before a choice.** The package sets no cookie, touches no storage and makes
   no request of its own until the visitor presses a button; reading the existing consent cookie is
   the only pre-choice I/O. Services in a _required_ category are the one exception by definition:
   they are granted from mount, so a gated required script runs and a required Consent Mode key
   starts `granted` before any choice. Optional services never do.
2. **Reject is as easy as accept.** The first layer always shows Accept all and Reject all with equal
   prominence; it cannot be configured away. Closing without a choice is never consent. In blocking
   mode there is no way to dismiss the banner: no close control, Escape is ignored, clicks on the
   backdrop are ignored, and the rest of the page is inert. In non-blocking mode a close control means
   "decide later" (nothing stored, banner returns on the next page), never reject.
3. **Strict-CSP clean.** No authored `style=""` attributes, no `setAttribute("style", …)`, no
   `style.cssText`, no `<style>` injection, no `eval`, no HTML in strings. Theme values become CSS
   custom properties applied one at a time through `element.style.setProperty`; the browser
   serialises these into the element's style attribute, but property-level CSSOM mutation is not
   governed by `style-src`. The stylesheet ships as a bundled asset. Works under Astro's hashed
   per-page CSP with no policy change.
4. **Config is the contract.** A versioned, validated config object. Unknown keys fail the build. New
   keys are additive within a major version. No runtime fetch of config.
5. **No framework in the core.** `mount(config)` on a `Document`; the Astro integration only bundles
   the config and injects one script.
6. **Small.** Core + stylesheet ≤ 6 KB gzipped; the Consent Mode and gating adapters are separate
   entry points so a site pays only for what it imports.
7. **Accessible by default.** WCAG 2.1 AA: dialog semantics, focus management, keyboard-complete,
   reduced-motion aware, visible focus. Colour contrast is a config responsibility; the integration
   checks it at build time.
8. **Locale-neutral.** All visitor-facing strings are supplied per locale in the config; the package
   ships no default copy. A single-language site, a bilingual site and a multilingual site must all
   work without a package change.

## Config (schema version 1)

```ts
export interface ConsentConfig {
  schemaVersion: 1;
  /** Bump to re-prompt every visitor (policy text, categories or services changed materially). */
  policyVersion: string;                      // ≤ 32 chars, e.g. "2026-10"
  cookie?: {
    name?: string;                            // default "consent"
    maxAgeDays?: number;                      // default 365; applies to accept and reject alike
    domain?: string;                          // default: host-only
    path?: string;                            // default "/"
  };
  defaultLocale: string;                      // used when <html lang> matches no entry
  locale?: string;                            // override; default document.documentElement.lang
  categories: Array<{
    id: string;                               // ^[a-z][a-z0-9_-]{0,31}$ ; nothing is implied
    required?: boolean;                       // shown locked-on; never toggleable
    services?: Array<{ id: string; cookies?: string[] }>;   // ids only; names/descriptions per locale
  }>;
  locales: Record<string, LocaleStrings>;     // see below
  layout?: {
    position?: "bottom-left" | "bottom-right" | "bottom-center" | "top-left" | "top-right" | "top-center" | "center";
    backdrop?: "dim" | "none";                // default "dim"
    blocking?: boolean;                       // default true; requires backdrop "dim"
    width?: string;                           // CSS length, default "min(28rem, calc(100vw - 2rem))"
    settingsPosition?: "center";              // the preferences dialog; v1 has one placement
  };
  theme?: {
    colors?: Partial<Record<ThemeColor, string>>;   // any CSS color
    radius?: { box?: string; button?: string; control?: string };
    font?: string;                            // CSS font-family; default inherits
    zIndex?: number;                          // default 2147483000
    vars?: Record<`--consent-${string}`, string>;   // escape hatch; may not name a `colors` token
  };
  validation?: {
    strictContrast?: boolean;                 // contrast failures fail the build; default false
  };
  buttons?: {
    settings?: boolean;                       // show "Settings" on the first layer; default true
    order?: Array<"acceptAll" | "rejectAll" | "settings">;   // an exact permutation, see validation
  };
  record?: ConsentRecorder | string;          // function, or a URL for the built-in bare-object sender
  // --- adapter keys: added in v0.2.0; rejected as unknown keys by v0.1.x (see Version boundary) ---
  consentMode?: {                             // Google Consent Mode v2 adapter (entry "./gtag")
    mapping: Record<string, GtagConsentKey[]>;   // category id → gtag keys
    extra?: Partial<Record<GtagConsentKey, "granted" | "denied">>;   // keys outside any category
  };
  gateScripts?: boolean;                      // script-gating adapter (entry "./gate"); default false
}

type ThemeColor =
  | "background" | "text" | "muted" | "link" | "border" | "backdrop" | "focus"
  | "acceptBackground" | "acceptText" | "rejectBackground" | "rejectText"
  | "settingsBackground" | "settingsText" | "saveBackground" | "saveText"
  | "toggleOn" | "toggleOff" | "toggleKnob";

interface LocaleStrings {
  title: string;
  description: string;                        // plain text; may contain {link:<id>} tokens
  acceptAll: string; rejectAll: string; settings: string; save: string; close: string;
  alwaysActive: string;                       // label on required categories
  settingsTitle: string; settingsDescription?: string;
  dialogLabel?: string;                       // aria-label fallback when title is decorative
  links?: Array<{ id: string; label: string; href: string }>;   // policy links; hrefs are per locale
  categories: Record<string, { name: string; description: string }>;   // one per category id
  services?: Record<string, { name: string; description?: string }>;
}
```

The config implies nothing: there is no built-in "necessary" row. A site that wants one declares a
category with `required: true`. A config with no required category is valid.

## Validation

Runs at build time in the Astro integration and is exported as `validateConfig` for other hosts.
Every rule below has a test. A failure names the offending key.

- `schemaVersion` is `1`; `policyVersion` is 1–32 characters.
- Category ids match `^[a-z][a-z0-9_-]{0,31}$` and are unique; service ids are unique across all
  categories.
- At least one optional (non-required) category exists. A config with none has nothing to consent
  to and fails.
- `defaultLocale` is a key of `locales`.
- Every category id and every declared service id has strings in every locale. A
  `categories`/`services` string key that matches no declared id fails, so a typo cannot silently
  leave a row unlabelled.
- Every `{link:<id>}` token in `description` and `settingsDescription` resolves to a `links` entry
  of the same locale.
- `buttons.order`, when given, is an exact permutation of the resolved button set: `acceptAll` and
  `rejectAll` exactly once each; `settings` exactly once when the resolved `buttons.settings` is not
  `false` (the default is `true`) and absent when it is `false`. An omission, duplicate or unknown
  entry fails, so the mandatory choices cannot be configured away. When `buttons.order` is omitted
  the order is `["acceptAll", "rejectAll", "settings"]` with `settings` dropped if disabled.
- `layout.blocking: true` requires `layout.backdrop: "dim"`.
- Every `theme.colors` value parses as a CSS colour.
- Contrast of `text` on `background`, and of each button's text on its background, is ≥ 4.5:1.
  A failure is a warning by default; `validation.strictContrast: true` makes it fail the build.
- `theme.vars` is rejected when a key is the custom property of a `colors` token, so the escape
  hatch cannot bypass the contrast check.
- Each gtag key in `consentMode.mapping` belongs to at most one category; a key listed twice, or in
  both `mapping` and `extra`, fails.
- `record`, when a string, is a root-relative path (`/…`) or an absolute `http(s)` URL; any other
  scheme or a scheme-relative URL fails.
- Unknown keys fail at every level.

The schema is written once (zod) and the TypeScript types are derived from it, so the interface
above and the runtime check cannot drift.

## Runtime behaviour

### Mount

`mount(config, document?)` reads the consent cookie. The banner is shown when there is no cookie,
when the stored `policyVersion` differs, or when the stored category set differs from the config
(a category added or removed). Any mismatch means **no consent**: consumers see every optional
category denied until a new choice. Otherwise the banner stays hidden and consumers get the stored
state immediately.

Mount is idempotent: a second call on the same document is a no-op and does not fire a second
initial callback.

### Required categories

Categories with `required: true` are **always granted**: before any choice, after Reject all, after
a withdrawal and on a stale cookie alike. They render locked-on in the settings dialog (labelled with
`alwaysActive`), are stored as `true` in the cookie, are reported as granted by `getConsent()`,
`onConsent`, the `data-consent-<id>` attributes, script gating and the Consent Mode mapping, and are
excluded from the "every optional category" rules in this document.

### Cookie

URL-encoded JSON: `{"v":1,"p":"<policyVersion>","t":<unix seconds>,"c":{"<id>":true|false,…}}`.
Attributes: `Max-Age` from `cookie.maxAgeDays`, `SameSite=Lax`, `Secure` when served over https,
`Path` and `Domain` from config (default `/`, host-only). A rejection is stored the same way so the
visitor is not asked again; storing the refusal is strictly necessary. An unparseable cookie is
treated as absent.

### Choice

Accept all / Reject all on the first layer; the settings dialog has one switch per non-required
category, Save, and Accept all / Reject all. A state-establishing or state-changing choice writes
the cookie, dispatches the change, records (if configured) and closes. A no-op (defined below) only
closes.

### Action semantics

The `action` reported to the recorder is derived from the transition, not from the button pressed:

| Action       | Condition                                                               |
| ------------ | ----------------------------------------------------------------------- |
| `accept_all` | every optional category ends granted                                    |
| `reject_all` | every optional category ends denied and none was granted before         |
| `withdraw`   | every optional category ends denied and at least one was granted before |
| `custom`     | any other mix                                                           |

"Before" means the valid stored choice, if any. With no valid stored choice (first visit, stale
policy or changed category set) every control is a first decision and is always written and
recorded; saving untouched switches on a first visit is a `reject_all`.

A **no-op** is only: a valid stored choice exists and the resulting optional state is identical to
it. Then nothing is written or recorded and the dialog just closes.

`withdraw()` with nothing granted before is a no-op when a valid stored choice exists and a
`reject_all` otherwise. Every transition is tested, including first-visit Save = `reject_all` and
accepted → reopen → all switches off → Save = `withdraw`.

### State API (`@edgesweden/consent`)

- `getConsent(): ConsentState | null` — the current state, or `null` before mount.
- `onConsent(cb)` — subscribes to consent state. A subscriber registered **before** mount is
  called once during mount with the initial state; a subscriber registered **after** mount is
  called immediately with the current state. Either way it is then called on every change. It is
  never called from the cookie alone before mount; this is what lets a consumer arm itself on the
  callback rather than on the cookie. Mount idempotency never suppresses a new subscriber's
  initial call. Returns an unsubscribe function.
- `openSettings()` — opens the preferences dialog.
- `withdraw()` — sets every optional category to denied; what it records, if anything, follows the
  action semantics above.

DOM mirror for non-bundled consumers: a `document` event `consent:change` with the state in
`detail`, and `data-consent-<id>="granted|denied"` attributes on `<html>` for CSS hooks. Any element
with `data-consent="open"` reopens the settings dialog (click delegation; no component needed).

`ConsentState` is `{ categories: Record<string, boolean>; policyVersion: string; locale: string;
at: number | null }` where `at` is the stored timestamp or `null` when no valid choice exists.

### Locale resolution

`config.locale` → `<html lang>` → `lang` without region (`sv-SE` → `sv`) → `defaultLocale`. Strings
are rendered as text nodes; `{link:<id>}` tokens become `<a>` elements. The resolved locale is never
empty and is included in every record.

### No visual flash

The stylesheet is imported by the core bundle; the banner is created on mount and hidden until
layout is applied. There is no server-rendered markup, so nothing can show without the script, and
nothing can be stored without the script.

## Accessibility

- The banner is `role="dialog"` with `aria-labelledby` the title (or `aria-label` from `dialogLabel`
  when the title is decorative), and `aria-modal="true"` in blocking mode.
- Focus moves to the dialog on open and returns to the opener on close. Tab cycles inside the dialog
  while blocking.
- Escape closes the settings dialog (returning to the banner if it was the opener) and does nothing
  on a blocking banner, as do clicks and taps on the backdrop.
- Blocking mode applies `inert` to sibling content while open and removes it on close.
- Switches are native checkboxes styled as toggles; no `role="switch"` is needed.
- Buttons are real `<button>` elements with visible text; the focus ring uses the `focus` theme
  colour and is never removed.
- Animations respect `prefers-reduced-motion`.
- The backdrop is not focusable and is hidden from assistive technology.

## CSP

The package must work under a strict policy such as `script-src 'self' 'sha256-…'; style-src 'self'`
with no additions:

- no authored `style=""` attributes, no `setAttribute("style", …)`, no `cssText`, no `<style>`
  elements; each theme value is applied individually through `style.setProperty` on the banner's
  root element, which CSP permits even though the browser serialises the result into a style
  attribute;
- no inline scripts; the Astro integration injects a bundled module that Astro's own CSP support
  hashes like any other page script;
- no `eval`, `new Function`, `innerHTML` or `insertAdjacentHTML`;
- no fetches except the optional record URL, which the site allow-lists itself.

Documented limit for script gating: under a hashed or strict CSP only external scripts whose host is
allow-listed can run this way; gated inline code needs its own hash or `'unsafe-inline'`.

## Adapters

Both adapters are separate entry points with the same shape: `install(config)` returns a disposer and
subscribes through the core's `onConsent`, so an adapter is just another consumer. Neither is
imported by the core. Script gating ships at `./gate`, Consent Mode at `./gtag`.

### Version boundary

- **v0.1.x:** the schema has no `gateScripts` and no `consentMode` key. Because unknown keys fail,
  a config that names either fails validation with a message pointing at the version that adds it.
  The `./gate` and `./gtag` entries do not exist.
- **v0.2.0:** adds both keys additively to schema version 1 (no bump; a v0.1 config stays valid),
  ships both entries, and teaches the Astro integration to include them conditionally.
  `gateScripts` defaults to `false` so that upgrading cannot activate behaviour a site did not ask
  for.

### Script gating (`@edgesweden/consent/gate`, `gateScripts: true`)

`installScriptGating(config)`: on each grant, every `<script type="text/plain" data-consent="<id>">` whose category is granted is
replaced once by a live script with the same `src`, attributes and text. A script is never run twice,
and a script whose category is denied is left untouched. Required categories are processed at mount.

### Google Consent Mode v2 (`@edgesweden/consent/gtag`)

`installConsentMode(config)` pushes `gtag("consent","default", …)` at mount with every key of an
optional category `denied`, every key of a required category `granted` and `extra` as configured,
then `gtag("consent","update", …)` per the mapping on every change, through `window.dataLayer`.
Each key is owned by one category (validated), so there is no precedence to resolve. The site must
load its tag after the consent script or gate it; documented with an example.

### Record (`record`)

```ts
type ConsentRecorder = (record: ConsentRecord) => void | Promise<void>;
interface ConsentRecord {
  action: "accept_all" | "reject_all" | "custom" | "withdraw";
  categories: Record<string, boolean>;
  policyVersion: string;
  packageVersion: string;
  locale: string;
  at: number;                                 // unix seconds
}
```

Called after each state-establishing or state-changing choice. A function recorder owns its
transport and payload shape, which is how a site adapts the record to an endpoint of its own. The
built-in string form posts the bare object as JSON via `sendBeacon` (fallback `fetch` with
`keepalive`). The **payload** carries no identifier, user agent or page; the HTTP request itself
still carries whatever the browser attaches (IP, user agent, referrer, same-origin cookies), which
is the receiving site's concern and is documented. Failures are swallowed and never surface to the
visitor.

### Astro integration (`@edgesweden/consent/astro`)

```ts
import consent from "@edgesweden/consent/astro";
export default defineConfig({ integrations: [consent({ config: "./src/consent.config.ts" })] });
```

The integration imports the config module at build time, runs `validateConfig`, fails the build on
error, exposes the config through a virtual module, and injects one `page` script that calls
`mount`. From v0.2.0 the injected script is generated per config: it imports `./gate` only when
`gateScripts` is `true` and `./gtag` only when `consentMode` is present, and calls each adapter's
`install` after `mount`. A site that uses neither ships neither byte. Nothing is added to layouts
or pages.

## Repository layout

```
theconsent/
  package.json            name, exports ("." core, "./astro", "./styles.css"; v0.2 adds "./gate", "./gtag"), sideEffects
  src/core/               mount, state, cookie, banner, settings, record, i18n, theme
  src/astro/              integration (injectScript "page" + virtual module for the config), validateConfig
  src/gate/               script-gating adapter (v0.2)
  src/gtag/               Consent Mode adapter (v0.2)
  src/styles.css          custom-property driven; prefix `consent-`
  test/                   vitest + happy-dom (see Tests)
  examples/astro/         neutral demo site (see Demo)
  scripts/                check gate, release-check (see Checks, Releases)
  .github/workflows/      ci.yml (the check gate), release.yml (tag-driven staged publish)
  AGENTS.md               points contributors and agents at this document
  docs/plan.md            this document: product contract and operating contract
  docs/decisions.md       append-only durable decisions
  docs/progress.md        package board
  docs/releasing.md       the per-release procedure and the npm trusted-publisher setup
  docs/reviews/           one file per package: evidence and review findings (see Delivery)
  README.md  CHANGELOG.md  LICENSE  SECURITY.md
```

Review evidence and findings live in `docs/reviews/<package>.md`; the check gate is `pnpm check`
locally and the `checks` job of `ci.yml` on GitHub.

Build: `tsup` to ESM only, `.d.ts` emitted, CSS copied. `engines.node >= 22`. TypeScript strict +
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Dependency metadata is package-level,
so it is declared with that in mind: Astro is an optional peer dependency (`>= 5`,
`peerDependenciesMeta.optional: true`) that only the `./astro` entry imports at runtime; zod is a
regular dependency, installed for every consumer, but imported only by the `./astro` and
`validateConfig` code paths and never bundled into the `.`, `./gate` or `./gtag` entries. The browser bundles
therefore have zero runtime dependencies, which the size budget verifies.

## Demo (`examples/astro/`)

A neutral Astro site that exists to exercise and document the package, with no reference to any
real site, brand or endpoint:

- two locales (`en`, `sv`) selected by `<html lang>`, with a language switch;
- one required category and two optional categories, each with at least one service;
- a gated `<script type="text/plain" data-consent="…">` per optional category (pointing at a local
  file) and one for the required category;
- the Consent Mode adapter with a stub `dataLayer` rendered on the page so the pushed entries are
  visible;
- a reopen control (`data-consent="open"`) in the footer and a `withdraw()` button;
- a `record` function that appends records to a visible list on the page;
- a strict CSP set through Astro's CSP support, so a violation shows in the console and in e2e.

The demo is built locally as the first step of `check:e2e` and is not hosted.

## Tests

### Unit (vitest + happy-dom, `test/`)

- **Config validation:** one test per rule in the Validation section, positive and negative.
- **Cookie codec:** encode/decode round trip, unparseable and foreign cookies treated as absent,
  `Secure` only on https, domain and path propagation.
- **Re-prompt matrix:** no cookie, same version, changed `policyVersion`, added category, removed
  category, unparseable cookie → shown/hidden and state reported.
- **State machine:** every transition in Action semantics, including first-visit Save =
  `reject_all`, accepted → all off → Save = `withdraw`, `withdraw()` both with and without a prior
  grant, and the no-op path writing nothing.
- **Required categories:** granted before any choice, after Reject all, after `withdraw()` and on a
  stale cookie; stored as `true`; locked in the dialog.
- **Nothing optional before a choice:** zero cookie writes, zero storage access, zero `fetch` and
  `sendBeacon` calls, and no gated optional script activated before a button is pressed.
- **Required services at mount:** a required gated script is activated and a required Consent Mode
  key is `granted` in the `default` push before any choice (a separate test from the one above).
- **Callbacks:** a pre-mount `onConsent` subscriber fires once during mount; a post-mount
  subscriber fires immediately with the current state; each then fires once per change and never
  from the cookie alone before mount; a second `mount` does not double-fire existing subscribers
  and does not block a new subscriber's initial call; unsubscribe works.
- **Script gating:** attributes and text preserved, each script activated once, denied scripts
  untouched.
- **Consent Mode:** `default` and `update` payloads for a mapping with required, optional and
  `extra` keys.
- **Record:** payload shape, `locale` always present, URL mode uses `sendBeacon` then `fetch`,
  failures swallowed, no record on a no-op.
- **Theme:** custom properties set through `style.setProperty` only; `setAttribute("style", …)`
  and `style.cssText` are never used (asserted by spying on both, since browsers serialise
  `setProperty` into the `style` attribute and an empty-attribute check would be wrong); `vars`
  applied, `zIndex` applied. The CSP guarantee itself is held by the zero-violation e2e assertion.
- **A11y attributes:** `role`, `aria-modal`, `aria-labelledby`/`aria-label`, `inert` on siblings
  while blocking, focus target on open and return on close.
- **Locale resolution:** each step of the fallback chain.

### End-to-end (Playwright + axe, run against the demo)

- Keyboard-only path through accept, reject, settings, save and reopen.
- Focus trap in blocking mode; Escape and backdrop click do nothing on a blocking banner; Escape
  closes the settings dialog and returns focus.
- Non-blocking mode: close control stores nothing and the banner returns on the next page.
- No storage and no request for an optional service before a choice (network and cookie assertions).
- The required gated script runs and the required Consent Mode key is `granted` before a choice.
- Cookie contents after each kind of choice; re-prompt after `policyVersion` bump.
- Reopen from the footer control and `withdraw()`; the record list shows the expected `action`.
- Locale switch changes every string; `{link:<id>}` renders as a link.
- Reduced motion: no transitions when `prefers-reduced-motion: reduce`.
- axe with no violations in each state: fresh banner, settings dialog open, after reject, after
  accept. Because axe skips inert content, the page outside the banner is audited after a choice.
- Zero CSP violations in the console across the whole run.

## Checks

The same gate runs locally as `pnpm check` and on GitHub as the `checks` job of
`.github/workflows/ci.yml`, on every push to any branch and on every pull request. Both run the
eight checks below in the same order under the same names, which are used in this document, in
`docs/progress.md` and in reviews; the CI steps are named exactly like the checks. The names are
fixed; the commands are `package.json` scripts, wired in P0.

| Name           | Command                                | Runs                                                                                 |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `check:types`  | `pnpm type-check`                      | `tsc --noEmit` over `src`, `test` and `examples`                                     |
| `check:lint`   | `pnpm lint`                            | eslint, including rules that ban the DOM and style APIs listed under CSP in this plan |
| `check:format` | `pnpm format:check`                    | `prettier --check .`                                                                 |
| `check:test`   | `pnpm test`                            | `vitest run`                                                                         |
| `check:deps`   | `pnpm audit --prod --audit-level=high` | known vulnerabilities in runtime dependencies                                        |
| `check:build`  | `pnpm build`                           | `tsup`, emits `dist/`                                                                |
| `check:size`   | `pnpm size`                            | `size-limit` against the budgets below                                               |
| `check:e2e`    | `pnpm test:e2e`                        | builds the demo, then Playwright + axe against it                                    |

`pnpm check` runs all eight in that order and stops at the first failure; "all checks green"
anywhere in this document means `pnpm check` exits 0 locally and the `checks` job passes in CI.
Node 22 (at least 22.22, which Astro requires; the repository scripts also need Node's type
stripping, which arrived in 22.18), pnpm
with a committed lockfile installed with `--frozen-lockfile`, Playwright's Chromium installed
before `check:e2e`. Run the relevant subset while working; run `pnpm check` before every review
request and paste its summary into the package's review file. A check that cannot run locally is
a blocker to fix before review: CI confirms the local result, it does not replace it. On `main`
the `checks` job is a required status check, so nothing merges with a red gate.

## Size budget

Measured on the built ESM after gzip, enforced by `check:size` with `size-limit`:

| Entry                       | Budget       |
| --------------------------- | ------------ |
| `.` (core incl. stylesheet) | 6 KB         |
| `./gate` (v0.2)             | 1 KB         |
| `./gtag` (v0.2)             | 1 KB         |
| `./astro` (build-time only) | not budgeted |

The budget is part of the public contract: raising it is a CHANGELOG entry.

## Releases

A release is an annotated tag `vX.Y.Z` on `main`, pushed by the maintainer. The tag starts
`.github/workflows/release.yml`, which runs the full CI workflow on the tagged commit, then the
release gates, then stages the package on npm with provenance through a trusted publisher. The
version goes live only when a maintainer approves the staged version with 2FA. No npm token exists
anywhere.

- Semantic versioning. Within `0.x`, minor bumps may change the config schema only additively;
  any breaking change to the config, the cookie format or the state API bumps the major.
- Release steps, in order: a release pull request bumps `version` in `package.json` and moves the
  `Unreleased` entries of `CHANGELOG.md` under the new version with the date; the implementer's
  `pnpm check` is green; after committing the release branch the maintainer runs
  `pnpm release:check` on it (it needs a clean tree, so it cannot run before the commit) and the
  release workflow runs it again on the tag; the pull request is reviewed and squash-merged and CI
  on `main` is green; the maintainer tags the merge commit (`git tag -a vX.Y.Z -m "vX.Y.Z"`) and pushes the
  tag; the release workflow finishes green; the maintainer approves the staged version.
  `docs/releasing.md` holds the exact commands and the trusted-publisher setup.
- `pnpm release:check` (`scripts/release-check.*`) refuses when the working tree is not clean
  (skipped in CI, where the checkout is clean by construction), when `CHANGELOG.md` has no
  non-empty, dated entry for the `package.json` version, when a tag passed as its argument is not
  `v` followed by that version, or when `pnpm pack --dry-run` lists anything outside `dist/`,
  `package.json`, `README.md`, `LICENSE` and `CHANGELOG.md`.
- The release workflow publishes only when the tagged commit is an ancestor of `origin/main`, the
  tag equals the `package.json` version and `release:check` passes on the built package; its
  publish job runs install, build, release check and stage, in that order.
- `CHANGELOG.md` follows Keep a Changelog.
- `packageVersion` in records is injected at build time from `package.json`.
- A bad release is fixed forward with a new patch tag; a tag is never moved or deleted and a
  version is never unpublished.
- The public repository starts from one import commit of the tree of `main` after P4.0
  (version 0.2.2). The local history
  and its milestone tags `v0.1.0`–`v0.2.2` stay with the maintainer and are never pushed; `v0.3.0`
  is the first public tag, and the tag rules above apply to the public repository.
- 0.3.0 is the first version of this codebase on npm. The 0.1.0–0.2.2 entries in `CHANGELOG.md`
  are local milestones that were tagged but never published; npm versions below 0.3.0 come from an
  earlier implementation of the same contract, which the 0.3.0 entry explains.

## Package slices

Each slice is a version. Within a slice, work lands in the packages below, in this order; each
package is implemented, reviewed and squash-merged on its own (see Delivery). These rows are the
initial contents of `docs/progress.md`; the tier is in parentheses.

**P0 — repository tooling.**

- `(A) P0` — package.json, tsup, vitest + happy-dom, eslint (with the CSP API bans), prettier,
  size-limit, Playwright + axe, `pnpm check`, `pnpm release:check`, the agent pointer file, `docs/`,
  LICENSE, SECURITY.md, README stub, CHANGELOG stub; `pnpm check` green on an empty package
  (plan: Repository layout, Checks).

**P1 — core + Astro integration, v0.1.0.** Config schema and validation, state machine, cookie,
banner, settings dialog (blocking and non-blocking, every position), theme, locale resolution,
reduced motion, record hook, the integration, the full unit suite and every non-adapter e2e
listed above, the demo without adapters, size budget, local release, README with the config
reference and the CSP limits.

- `(A) P1.1` — Config schema + `validateConfig`, one test per rule (plan: Config, Validation)
- `(A) P1.2` — Cookie codec + state machine + state API + DOM mirror (plan: Cookie, Action
  semantics, State API)
- `(A) P1.3` — Banner + settings dialog: DOM, focus, blocking and non-blocking, positions (plan:
  Runtime behaviour, Accessibility)
- `(A) P1.4` — Theme + locale resolution + link tokens, CSP-clean (plan: Config, Locale
  resolution, CSP)
- `(A) P1.5` — Record hook: function and URL forms (plan: Record)
- `(B) P1.6` — Astro integration: build-time validation, virtual module, injected script (plan:
  Astro integration)
- `(B) P1.7` — Demo site + e2e suite with axe and CSP assertions (plan: Demo, Tests)
- `(A) P1.8` — Size budget, `release:check`, README, CHANGELOG, local tag `v0.1.0` (plan: Size
  budget, Releases)

**P2 — adapters, v0.2.0.** Script gating and Consent Mode v2 with their unit tests and e2e,
demo updated, README sections.

- `(A) P2.1` — Script-gating adapter + `gateScripts` key (plan: Script gating, Version boundary)
- `(A) P2.2` — Consent Mode v2 adapter + `consentMode` key (plan: Google Consent Mode v2)
- `(B) P2.3` — Conditional adapter imports in the integration, demo and README updates, local tag
  `v0.2.0` (plan: Astro integration, Demo)

**P3 — fixes forward, v0.2.1 and v0.2.2.** Rows added after reviews of the local releases; see
`docs/progress.md` and decisions #52–#59.

**P4 — public repository and first npm release, v0.3.0.** CI, a tag-driven staged release,
a config loader that watches the config's dependencies, one-pass validation, small hardening.

- `(A) P4.0` — Operating contract for the public repository: CI, pull requests, tag-driven
  staged releases, read-only git for agents, no tooling references (plan: Delivery, Checks,
  Releases, Repository layout)
- P4.1 — the import of the tree of `main` after P4.0 into the public repository (see Releases); a maintainer
  step with no board row.
- `(B) P4.2` — CI workflow running the check gate on every push and pull request (plan: Checks)
- `(A) P4.3` — Release workflow with staged provenance publishing, tag/version gate,
  `docs/releasing.md` (plan: Releases)
- `(A) P4.4` — Vite-based config loader with dependency watching, `astro >= 5.4` (plan: Astro
  integration)
- `(A) P4.5` — Validation reports schema and cross-field errors in one pass (plan: Validation)
- `(A) P4.6` — Hardening: late content stays inert, unique id prefix, `theme.vars` runtime guard
  (plan: Accessibility, Validation, CSP)
- `(A) P4.7` — Release 0.3.0, the first published version (plan: Releases)

## Delivery

Work is delivered package by package, in the order of `docs/progress.md`, as pull requests to the
public repository `EdgeSweden/theconsent`. An implementer (a contributor or an automated agent)
builds one package in a working tree, runs the checks and writes the evidence; a reviewer who did
not write the code reviews it; the maintainer commits, opens and merges the pull request, pushes
and tags. Decisions that a package needs and this plan does not settle are recorded in
`docs/decisions.md` and named in the package's handoff, so the maintainer can overrule them
before merge.

### Core principle

Work lands in small, reviewable packages. A package is not done when the code is written. It is
done when `pnpm check` is green locally and in CI, the evidence is in the review file and an
independent review has passed.

### Authority order

When instructions conflict:

1. Hard invariants in this section.
2. The latest applicable entry in `docs/decisions.md`.
3. The rest of this plan.
4. Existing repository conventions.
5. Implementer preference.

If two authorities conflict, stop the affected work, append the conflict and the resolution chosen
to `docs/decisions.md`, annotate the `[~]` row with `decision taken, see #N`, name it in the
handoff, and continue. Do not pick one silently.

### Tiers

Every package has a tier. The tier decides how much process it gets.

**Tier A: load-bearing.** Anything that touches:

- what happens before the visitor has chosen: cookie writes, storage, network, activating an
  optional script (Principles, 1);
- the first layer's Accept all / Reject all parity and blocking-mode non-dismissability
  (Principles, 2);
- CSP cleanliness of the browser bundles: any style, script or HTML-string API in `src/core`,
  `src/gate` or `src/gtag` (CSP);
- a public contract: config schema and validation rules, cookie format, state API and DOM mirror,
  record payload, package `exports`, size budgets;
- action semantics: what is stored and recorded for each transition;
- dependencies: adding one, or moving zod or Astro out of their build-time-only position;
- releasing: `release:check`, the release workflow, npm publishing, versioning, the CHANGELOG gate;
- this operating contract.

Tier A packages are vertical and independently testable. Never ship a partial privacy or security
mechanism that looks complete from the outside. Before implementing a Tier A package, confirm the
plan settles its contract; where it does not, append the gap and the chosen resolution to
`docs/decisions.md` before writing code, so the reviewer can judge the code against a written
contract.

**Tier B: ordinary capability.** Integration plumbing, the demo, the CI workflow, docs tooling;
nothing on the Tier A list.

**Tier C: local and reversible.** Copy, styling, small refactors. Acceptance criteria in the task,
implement, run the relevant checks, self-review. Still lands through its own pull request.

When unsure, pick the higher tier only if the change actually touches a Tier A surface. If a
review finds Tier A risk in a Tier B package, reclassify and apply the stronger protocol.

### Board

`docs/progress.md` is the board: one line per package, nothing else.

```text
[ ] not started   [~] in progress; annotate the state   [x] reviewed and accepted
```

Row: `- [ ] (A) P1.1 - Config schema + validateConfig (plan: Config, Validation)`

One `[~]` at a time. The next package starts only after the current one is `[x]` and merged.

### Roles

Keep these separate, whoever fills them.

- **Maintainer** (a repository owner): owns git and every external system. Creates branches and
  commits from the implementer's working tree, opens, reviews and squash-merges pull requests,
  pushes, tags, configures GitHub and npm, approves staged releases, and resolves anything a
  handoff flags.
- **Implementer**: builds one package in a working tree, runs the checks, writes the review file,
  arranges the review, fixes findings and hands the package to the maintainer. Uses git read-only
  (`status`, `diff`, `log`, `blame`, `show`); does not commit, branch, merge, push or tag. Does not
  declare the package done and does not mark a row `[x]`.
- **Reviewer**: reviews one round from a code-review stance and performs the review handoff below.

### Review

Review is required before any package merges.

**Hard invariant: the review is done by a person or a session that did not write the code and has
none of the implementer's context.** A continuation or a copy of the implementer's working
context is not a review.

The brief the reviewer receives is exactly: the path of this plan; the `docs/progress.md` row and
tier; the command that shows the change under review (`git diff main` together with
`git status --short` for new files while the change is uncommitted, or the pull request's diff);
the path of the package's review file; and the findings protocol below. The brief never contains
the implementer's opinion of the code, a summary of what the code does, or a question that
invites confirmation. The reviewer reads the plan and the change itself.

**Review file.** Before requesting review the implementer writes `docs/reviews/<package>.md`
(for example `docs/reviews/P1.1.md`) with: the row and tier; *Why* (what a reader cannot get from
the diff; becomes the commit body); the `pnpm check` summary; and the checklist (tests cover the
behaviour added or changed; `CHANGELOG.md` updated under Unreleased or nothing user-visible
changed; `docs/decisions.md` appended or nothing durable decided; no real site, brand, domain or
endpoint in demo, tests or docs; nothing in the change breaks Public repository neutrality). The
reviewer appends `## Review 1` with its findings; re-reviews append `## Review 2`, and so on. The
file is committed with the package.

Findings lead the review, ordered by severity:

- **P1** blocks merge: privacy leakage, any optional I/O before a choice, a CSP violation, a
  broken acceptance criterion, a hard invariant violation, data loss.
- **P2** normally blocks merge: a concrete correctness, reliability or error-handling defect with
  a realistic failure scenario.
- **P3** advisory: simplification, naming, docs.

Every P1/P2 states the location, the violated requirement, a concrete failure scenario, the
smallest safe fix and the regression test needed. Uncertain concerns go under `Questions`, not
findings. Do not report what `check:lint` or `check:format` already enforce. A review with no
P1/P2 ends with `Verdict: pass` and the handoff below; otherwise `Verdict: changes required`.

**Re-review** is targeted and is done by a reviewer new to the change: it receives the previous
round's findings and the same diff command, and reviews the fixes and the directly affected
regression surfaces. A full re-review is only warranted when the fix changed architecture, a data
shape or a public contract.

If a package is not accepted after three rounds, work stops, the working tree and the review file
stay in place, the row is annotated and the maintainer decides.

**Handoff when the review passes.** The reviewer, not the implementer:

1. marks the row `[x]` in `docs/progress.md`;
2. proposes the exact squash-commit subject in the format below;
3. states that the package is ready to merge.

Any substantive change after this point needs targeted review again before merge.

### Branches, pull requests and commits

The repository is `EdgeSweden/theconsent` on GitHub. `main` is always releasable, protected and
linear: changes land only through pull requests, the CI `checks` job is a required status check,
and every pull request is squash-merged, so `main` holds one commit per package. Branches are
short-lived and named `<type>/<slug>` (`feat/config-loader`, `fix/focus-return`); a branch is
deleted after its merge. Releases are annotated tags `vX.Y.Z` on `main` (see Releases).

Implementers and automated agents use git read-only. The maintainer creates branches, commits,
pushes, opens and merges pull requests and tags. Nobody force-pushes `main`, moves or deletes a
tag, or pushes a tag that is not a release.

Commits follow Conventional Commits:

```text
<type>(<scope>): <summary>

<body: why this change, what a reader cannot get from the diff>

<footer>
```

- **type**: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `chore`, `ci`, `revert`.
- **scope**: `core`, `astro`, `gate`, `gtag`, `demo`, `release`; omit for repository-wide changes.
- **summary**: imperative mood, lower case, no trailing period, 72 characters or fewer.
- **body**: the *Why* from the review file; wrapped at 72; explains why, never restates the diff.
  Cite the plan by section heading when it helps (`Plan: Action semantics`).
- **footer**: `BREAKING CHANGE: <what breaks and how to migrate>` together with `!` after the
  scope for any break of the config, cookie format or state API.
- `feat` is a minor bump, `fix` a patch, `!` a major; `CHANGELOG.md` and the tag follow.
- No attribution trailers and no tool or model names in commit messages or pull-request text.

```text
chore: add project tooling and local check gate
feat(core): add config schema and validateConfig
feat(core): implement cookie codec and consent state machine
fix(core): return focus to the opener when the settings dialog closes
feat(gtag): add Consent Mode v2 adapter
ci: run the check gate on every push and pull request
docs: describe the CSP limit for gated inline scripts
feat(core)!: store the category list as an array in the cookie
```

### Durable decisions

Append to `docs/decisions.md` when this plan already determines something worth stating as a fact,
or when a package needs something the plan leaves unsettled. Never edit an existing entry; append a
superseding one. Every entry made in a package is repeated in its handoff.

```md
YYYY-MM-DD - <decision as a fact, one sentence> - <why/trigger> (decision #N, plan: <section>)
```

### Safety

- The browser entries (`.`, `./gate`, `./gtag`) have zero runtime dependencies. zod is imported
  only by `./astro` and `validateConfig`; Astro only by `./astro`.
- Never weaken the demo's CSP or add `'unsafe-inline'` to make something pass.
- npm publishing happens only through the release workflow, staged and approved by a maintainer
  with 2FA. Never run `npm publish`, `pnpm publish` or `npm stage publish` by hand, and never
  create an npm token. Implementers and agents never push, tag or add a remote.
- The toolchain named in this plan is pre-approved: TypeScript, tsup, vitest, happy-dom, eslint,
  typescript-eslint, prettier, size-limit, Playwright, axe-core, zod, Astro (and the Vite it
  ships) for the demo, the integration and the peer dependency, and the GitHub Actions
  `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` and `pnpm/action-setup`.
  Any other dependency is a `docs/decisions.md` entry stating why no pre-approved tool suffices.
- Do not change a public contract as an incidental fix.
- Secrets never enter the repository. There is nothing to store: CI needs no secret and npm
  trusts the release workflow through OIDC.

### Public repository neutrality

The repository is public; everything is written for a stranger.

- The demo, tests, fixtures and docs use neutral names only: no real site, brand, customer,
  domain or endpoint. Example hosts are `example.com` and `example.org`.
- No internal links, ticket ids, private hostnames or references to other projects or
  repositories.
- No names of the tools, assistants or models used to write or review the code, no description
  of how a working session was run, and no attribution trailers, in files, commit messages or
  pull requests. Tool configuration files that a contributor's own tooling reads are the one
  exception, and they hold only a pointer to `AGENTS.md`.
- Visitor-facing strings exist only in the demo's locale config; the package ships no copy.

### Package flow

1. Pick the next `docs/progress.md` row, confirm its tier, mark it `[~]`.
2. Tier A: confirm the plan settles the contract, or append the gap and the chosen resolution to
   `docs/decisions.md` first.
3. Implement only that package, with its tests, in a working tree based on the current `main`.
4. Run the relevant checks while working; run `pnpm check` before review.
5. Write `docs/reviews/<package>.md` with the evidence. Update `CHANGELOG.md` under `Unreleased`
   for anything user-visible.
6. Arrange an independent review with the brief defined under Review. Fix P1/P2 findings in the
   working tree; arrange a new reviewer for the re-review. At most three rounds.
7. The reviewer marks `[x]` and proposes the commit subject.
8. Hand the package to the maintainer (see Handoff).
9. The maintainer commits it on a branch, opens the pull request, waits for CI, squash-merges with
   the proposed subject and the *Why* as body, and deletes the branch.
10. For a release package, the maintainer then follows `docs/releasing.md`.

### Handoff

Each package ends with a handoff to the maintainer, in the pull request description or the
conversation that delivered it (not a file): the row, the files changed, the review file, the
proposed commit subject and body, every `docs/decisions.md` entry made, anything a review left
under `Questions`, the last `pnpm check` summary, the confirmation that the tree satisfies Public
repository neutrality, and every maintainer step the package needs (GitHub or npm settings, tags).

## Out of scope for v0.x

- Per-visitor consent logs or any server component.
- Global Privacy Control handling (reserved config key `gpc`, planned for a later minor).
- TCF / IAB strings; programmatic advertising needs a different tool.
- Server-rendered banner markup.
- Framework integrations other than Astro; the core is usable from any host via `mount`.
- A visual editor or hosted config.

## Open questions

None blocking. Decisions taken so far: package name `@edgesweden/consent`, MIT licence, default
cookie name `consent`, blocking + dimmed as the default layout, Astro as the only v1 framework
integration, public repository `EdgeSweden/theconsent` with CI, pull requests and tag-driven
staged npm releases (decision #60).
