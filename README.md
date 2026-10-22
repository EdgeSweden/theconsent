# @edgesweden/consent

A config-driven cookie-consent banner for static and server-rendered sites.

- **Nothing optional before a choice.** No cookie, storage or request of its own until the visitor
  presses a button. Reading the existing consent cookie is the only I/O before that.
- **Reject is as easy as accept.** Accept all and Reject all are always on the first layer with
  the same styling. In blocking mode the banner cannot be dismissed without a choice.
- **Strict-CSP clean.** No inline styles, `<style>` injection, `eval` or HTML strings. It works
  under Astro's hashed CSP with no policy change.
- **Small and framework-free.** The core and its stylesheet are under 6 KB gzipped, with zero
  runtime dependencies in the browser.
- **Accessible.** Dialog semantics, focus management, keyboard-complete, reduced-motion aware.
- **Locale-neutral.** Every visitor-facing string comes from your config. The package ships no
  copy.

There is no backend. Everything is one config file per site.

## Contents

- [Install](#install)
- [Astro](#astro)
- [Other hosts](#other-hosts)
- [Config reference](#config-reference)
- [Validation](#validation)
- [Runtime behaviour](#runtime-behaviour)
- [State API](#state-api)
- [Records](#records)
- [CSP](#csp)
- [Accessibility](#accessibility)
- [Requirements](#requirements)
- [Versioning](#versioning)
- [Releases and contributing](#releases-and-contributing)

## Install

```sh
pnpm add @edgesweden/consent
```

## Astro

```ts
// astro.config.ts
import consent from "@edgesweden/consent/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [consent({ config: "./src/consent.config.ts" })],
});
```

```ts
// src/consent.config.ts
import type { ConsentConfig } from "@edgesweden/consent";

const config: ConsentConfig = {
  schemaVersion: 1,
  policyVersion: "2026-10",
  defaultLocale: "en",
  categories: [
    { id: "necessary", required: true },
    { id: "analytics", services: [{ id: "stats", cookies: ["_stats"] }] },
  ],
  locales: {
    en: {
      title: "Cookies",
      description: "We use cookies for statistics if you allow it. Read the {link:policy}.",
      acceptAll: "Accept all",
      rejectAll: "Reject all",
      settings: "Settings",
      save: "Save",
      close: "Close",
      alwaysActive: "Always active",
      settingsTitle: "Cookie settings",
      links: [{ id: "policy", label: "cookie policy", href: "/cookies/" }],
      categories: {
        necessary: { name: "Necessary", description: "Needed for the site to work." },
        analytics: { name: "Analytics", description: "Anonymous usage statistics." },
      },
      services: { stats: { name: "Statistics" } },
    },
  },
};

export default config;
```

At build time the integration imports the config module, validates it and fails the build with
every offending key. It then injects one page script that calls `mount`, plus the stylesheet. The
script also imports and installs `./gate` when `gateScripts` is `true` and `./gtag` when
`consentMode` is set, so a site that uses neither ships neither. Nothing is added to your layouts
or pages. Contrast problems are logged as warnings unless
`validation.strictContrast` is `true`.

At build time the config module is loaded through the module runner of the Vite that your Astro
uses. In `astro dev`, a change to the config or to any module it imports restarts the server and
revalidates.

Supported in the config module:

- TypeScript and JavaScript modules;
- relative imports, with or without file extensions;
- JSON imports, for example a strings file per locale;
- imports of installed packages.

Not supported in the config module, because it is loaded without your site's Vite or Astro
configuration:

- path aliases defined in `tsconfig.json` or in Vite's `resolve.alias`;
- `import.meta.env`: a config that reads it fails the build, because the value validated at
  build time could differ from the one shipped to the browser.

The config is also bundled for the browser, so keep it free of server-only code. To vary the
config per build, choose between two config files in `astro.config.ts`. Do not branch inside the
config: the validated object and the shipped object must be the same.

### Astro's ClientRouter

Client-side navigation with `<ClientRouter />` is supported. After each swap the banner and
settings dialog are rebuilt on the new page in that page's language (`getConsent().locale`
follows it; consent itself did not change, so no `consent:change` is sent), and the
`data-consent-<id>` attributes are re-applied. Once the router has finished the new page, script
gating activates its placeholders. Each placeholder is activated once; an external script URL is
loaded at most once per document, even when several placeholders or pages name it. Astro's CSP
support does not cover the ClientRouter, so a site has to choose between the two.

## Other hosts

The core runs on any page with a `document`, bundled by a tool that handles CSS imports (Vite,
esbuild, webpack and so on). `dist/index.js` imports its own `./styles.css`, so it cannot be loaded
as a native ES module without a bundler.

```ts
import { mount } from "@edgesweden/consent"; // also pulls in @edgesweden/consent/styles.css
import config from "./consent.config.js";

mount(config);
```

`mount` does not validate. Run `validateConfig` in your build, or in a test:

```ts
import { validateConfig } from "@edgesweden/consent/astro";

const result = validateConfig(config);
if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"));
```

`validateConfig` returns `{ ok: true, config, warnings }` or `{ ok: false, errors, warnings }`.
Each issue is `{ path, message }`, where `path` names the key (`locales.sv.categories.ads`). The
`./astro` entry needs zod, which is a regular dependency. It needs Astro only for the integration
itself.

## Config reference

Schema version 1. Unknown keys fail validation at every level. New keys are additive within a
major version.

| Key                         | Type                                                                                            | Default                              | Notes                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `schemaVersion`             | `1`                                                                                             | required                             |                                                                                           |
| `policyVersion`             | string, 1–32 chars                                                                              | required                             | Bump it to ask every visitor again.                                                       |
| `cookie.name`               | cookie-name token                                                                               | `"consent"`                          |                                                                                           |
| `cookie.maxAgeDays`         | positive number                                                                                 | `365`                                | Applies to accept and reject alike.                                                       |
| `cookie.domain`             | host name                                                                                       | host-only                            |                                                                                           |
| `cookie.path`               | string starting with `/`                                                                        | `"/"`                                |                                                                                           |
| `defaultLocale`             | key of `locales`                                                                                | required                             | Used when `<html lang>` matches no locale.                                                |
| `locale`                    | key of `locales`                                                                                | `<html lang>`                        | Forces a locale.                                                                          |
| `categories[]`              | `{ id, required?, services? }`                                                                  | required                             | At least one optional category. Nothing is implied: no built-in "necessary" row.          |
| `categories[].id`           | `^[a-z][a-z0-9_-]{0,31}$`                                                                       |                                      | Unique.                                                                                   |
| `categories[].required`     | boolean                                                                                         | `false`                              | Always granted, shown locked on.                                                          |
| `categories[].services[]`   | `{ id, cookies? }`                                                                              | `[]`                                 | Service ids are unique across categories. `cookies` lists names for display only.         |
| `locales`                   | `Record<string, LocaleStrings>`                                                                 | required                             | See below.                                                                                |
| `layout.position`           | `bottom-left`, `bottom-center`, `bottom-right`, `top-left`, `top-center`, `top-right`, `center` | `"bottom-center"`                    | The banner. The settings dialog is always centred.                                        |
| `layout.backdrop`           | `"dim"` \| `"none"`                                                                             | `"dim"`                              |                                                                                           |
| `layout.blocking`           | boolean                                                                                         | `true`                               | Requires `backdrop: "dim"`. Set `false` to use `backdrop: "none"`.                        |
| `layout.width`              | CSS length                                                                                      | `min(28rem, calc(100vw - 2rem))`     |                                                                                           |
| `layout.settingsPosition`   | `"center"`                                                                                      | `"center"`                           |                                                                                           |
| `theme.colors`              | `Partial<Record<ThemeColor, string>>`                                                           | see `styles.css`                     | Hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, named colours.    |
| `theme.radius`              | `{ box?, button?, control? }`                                                                   | `0.75rem`, `0.5rem`, `999px`         |                                                                                           |
| `theme.font`                | CSS `font-family`                                                                               | inherited                            |                                                                                           |
| `theme.zIndex`              | integer                                                                                         | `2147483000`                         |                                                                                           |
| `theme.vars`                | `Record<"--consent-…", string>`                                                                 | `{}`                                 | Escape hatch, applied last. It may not name a colour token; use `theme.colors` for those. |
| `validation.strictContrast` | boolean                                                                                         | `false`                              | Turns contrast warnings into build errors.                                                |
| `buttons.settings`          | boolean                                                                                         | `true`                               | Shows Settings on the first layer.                                                        |
| `buttons.order`             | permutation of the resolved buttons                                                             | `acceptAll`, `rejectAll`, `settings` | Must list `acceptAll` and `rejectAll` once each, and `settings` once only when enabled.   |
| `record`                    | function \| string                                                                              | none                                 | See [Records](#records).                                                                  |

`ThemeColor` is one of `background`, `text`, `muted`, `link`, `border`, `backdrop`, `focus`,
`acceptBackground`, `acceptText`, `rejectBackground`, `rejectText`, `settingsBackground`,
`settingsText`, `saveBackground`, `saveText`, `toggleOn`, `toggleOff` or `toggleKnob`. Each one
becomes the custom property `--consent-<kebab-case>`, for example `--consent-accept-background`.

### Locale strings

| Key                                                   | Notes                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `title`                                               | The dialog's heading. If it is empty, `dialogLabel` is required.               |
| `description`                                         | Plain text. `{link:<id>}` tokens become links.                                 |
| `acceptAll`, `rejectAll`, `settings`, `save`, `close` | Button labels, non-empty.                                                      |
| `alwaysActive`                                        | Label shown on required categories.                                            |
| `settingsTitle`                                       | The settings dialog's heading.                                                 |
| `settingsDescription`                                 | Optional. Plain text with `{link:<id>}` tokens.                                |
| `dialogLabel`                                         | Optional `aria-label` when the title is empty.                                 |
| `links[]`                                             | `{ id, label, href }`, per locale. `href` is relative, http(s), mailto or tel. |
| `categories`                                          | `{ name, description }` for every category id, and no other keys.              |
| `services`                                            | `{ name, description? }` for every service id, and no other keys.              |

Locale resolution: `config.locale`, then `<html lang>`, then the language without its region
(`sv-SE` becomes `sv`), then `defaultLocale`. Matching is case-insensitive. Strings are always
rendered as text and never parsed as HTML.

## Validation

`validateConfig` and the Astro integration check the following:

- `schemaVersion` is `1`, and `policyVersion` is 1 to 32 characters.
- Category ids match the id pattern and are unique. Service ids are unique across all categories.
- At least one optional (non-required) category exists.
- `defaultLocale`, and `locale` when given, are keys of `locales`.
- Every locale has strings for every category and service id, and no strings for ids that don't
  exist.
- Every `{link:<id>}` token resolves to a link in the same locale.
- `buttons.order`, when given, is an exact permutation of the resolved buttons.
- Blocking mode, which is the default, requires `backdrop: "dim"`.
- Every theme colour parses. The contrast of `text` on `background`, and of each button's text on
  its background, is at least 4.5:1. A failure is a warning, or an error with `strictContrast`.
- `theme.vars` may not override a colour token.
- `record`, when a string, is a root-relative path or an absolute http(s) URL.
- Unknown keys fail everywhere.

## Runtime behaviour

- **Cookie.** The consent cookie holds URL-encoded JSON:
  `{"v":1,"p":"<policyVersion>","t":<unix seconds>,"c":{"<id>":true|false}}`. It is set with
  `Max-Age` from `maxAgeDays`, `SameSite=Lax` and `Path`, plus `Secure` on https and `Domain` if
  configured. A rejection is stored the same way, so the visitor is not asked again.
- **Re-prompt.** The banner shows when there is no cookie, the cookie is unparseable, the
  `policyVersion` changed, or a category was added or removed. Until a new choice, every optional
  category counts as denied.
- **Required categories** are always granted: before any choice, after Reject all and after a
  withdrawal.
- **Blocking mode** (the default) has no close control. Escape and backdrop clicks do nothing,
  the rest of the page is `inert`, and focus stays in the dialog.
- **Non-blocking mode** has a close control that means "decide later". Nothing is stored, and
  the banner returns on the next page. Escape does the same.
- **Actions.** Each choice is reported as one of these:

  | Action       | When                                                                         |
  | ------------ | ---------------------------------------------------------------------------- |
  | `accept_all` | Every optional category ends up granted.                                     |
  | `reject_all` | Every optional category ends up denied, and none was granted before.         |
  | `withdraw`   | Every optional category ends up denied, and at least one was granted before. |
  | `custom`     | Any other mix.                                                               |

  If a valid choice already exists and the new one is identical, nothing is written or recorded.
  The dialog just closes.

## State API

```ts
import { getConsent, onConsent, openSettings, withdraw } from "@edgesweden/consent";

const off = onConsent((state) => {
  if (state.categories.analytics) loadAnalytics();
});
```

- `getConsent()` returns `{ categories, policyVersion, locale, at }`, or `null` before mount.
  `at` is the time of the stored choice in unix seconds, or `null` when there is no valid choice.
- `onConsent(cb)`: a subscriber registered before mount is called once during mount. One
  registered after mount is called immediately. After that, every subscriber is called on each
  change. The function returns an unsubscribe function.
- `openSettings()` opens the settings dialog.
- `withdraw()` denies every optional category.

For pages without a bundler:

- A `consent:change` event fires on `document` at mount and on every change. `event.detail` is
  the state.
- `<html>` carries `data-consent-<id>="granted|denied"` for each category, for CSS hooks.
- Any element with `data-consent="open"` opens the settings dialog when clicked:
  `<button type="button" data-consent="open">Cookie settings</button>`.

## Records

`record` is called after each choice that establishes or changes the state. It is never called
at mount, on a no-op, or when a non-blocking banner is closed.

```ts
interface ConsentRecord {
  action: "accept_all" | "reject_all" | "custom" | "withdraw";
  categories: Record<string, boolean>;
  policyVersion: string;
  packageVersion: string;
  locale: string;
  at: number; // unix seconds
}
```

- **A function** gets the record and handles transport and payload shape itself. This is how
  you adapt the record to an endpoint of your own. A rejected promise is ignored.
- **A URL** (`"/consent"` or `"https://example.com/consent"`) receives the bare record as JSON. It
  is sent with `navigator.sendBeacon`, falling back to `fetch(…, { method: "POST", keepalive: true
})`. Failures never reach the visitor.

The payload carries no identifier, user agent or page. The HTTP request still carries whatever
the browser attaches: IP address, user agent, referrer, and the endpoint origin's own cookies
(subject to `SameSite`). Handling those is
the receiving site's concern. A cross-origin URL gets an `application/json` body, so the endpoint
must answer the CORS preflight. It must also be allowed by your CSP's `connect-src`.

## Script gating

Set `gateScripts: true`. With the Astro integration that is all: it imports and installs the
adapter after `mount`. Elsewhere, install it yourself:

```ts
import { installScriptGating } from "@edgesweden/consent/gate";

installScriptGating(config); // returns a disposer
```

Mark each script that needs consent as inert text, naming its category:

```html
<script type="text/plain" data-consent="analytics" src="/js/stats.js" async></script>
<script type="text/plain" data-consent="marketing" data-type="module">
  import("/js/ads.js");
</script>
```

When the category is granted, the placeholder is replaced, once, by a live `<script>` with the same
attributes and text (`data-type` becomes its `type`, and a `nonce` is carried over). The one
attribute added is `data-astro-exec`, which stops Astro's ClientRouter from running the script again
after a navigation. Denied scripts stay inert. Scripts in a required category run at mount, before
any choice.

Activated scripts keep the order they would have without gating. Classic scripts run in page
order: each one is inserted only after every earlier external classic script without `async` has
loaded or failed, so a library followed by its inline init code works. Modules run in page order
among themselves; like any module they are deferred, so a classic script after a module may run
before it. An external script URL is loaded at most once per document, even if several
placeholders name it. A script with `async` holds up nothing, and a classic script the browser skips (for
example `nomodule`) is not waited for.

Placeholders are evaluated at install, at `DOMContentLoaded` if the adapter was installed before
the body was parsed, and on every consent change. A placeholder added later stays inert until the
next change. A script that has run cannot be undone by a later withdrawal; reload the page to stop
it.

## Google Consent Mode v2

Map each category to the gtag consent keys it controls:

```ts
consentMode: {
  mapping: {
    necessary: ["security_storage"],
    analytics: ["analytics_storage"],
    marketing: ["ad_storage", "ad_user_data", "ad_personalization"],
  },
  extra: { functionality_storage: "granted" }, // keys outside any category
},
```

With the Astro integration that is all: it imports and installs the adapter after `mount`.
Elsewhere, install it yourself:

```ts
import { installConsentMode } from "@edgesweden/consent/gtag";

installConsentMode(config); // returns a disposer
```

At install it pushes `gtag("consent", "default", …)` onto `window.dataLayer`. Keys of optional
categories start `denied`, keys of required categories start `granted`, and `extra` keys get
their configured value. After that, it pushes `gtag("consent", "update", …)` whenever the mapped
values change, including once at mount for a returning visitor who granted something. Each key
belongs to at most one category and may not also appear in `extra`; validation enforces both, and
mapped categories must exist. A gtag key that is neither mapped nor in `extra` is left out of
`default`, and Google tags treat an unset key as unrestricted, so map or list every key your tags
use. The adapter loads no tag.

Load your Google tag **after** the consent script, or gate it with `data-consent` (see
[Script gating](#script-gating)), so the `default` command is in `dataLayer` first:

```html
<!-- Your Google tag loader, gated by its category. -->
<script type="text/plain" data-consent="analytics" async src="https://example.com/tag.js"></script>
```

Allow the tag's host in your CSP's `script-src` and `connect-src`.

## CSP

The package works under a policy such as `script-src 'self' 'sha256-…'; style-src 'self'` with no
additions:

- It never sets inline `style=""` attributes, `setAttribute("style", …)`, `style.cssText` or
  `<style>` elements. Theme values are applied one at a time with `style.setProperty` on the
  banner's root element. CSP permits this, even though the browser shows the result as a style
  attribute.
- It never uses `eval`, `new Function`, `innerHTML` or `insertAdjacentHTML`.
- The stylesheet is a separate asset (`@edgesweden/consent/styles.css`).
- It makes no request except to the optional record URL, which you allow-list yourself.
- With Astro's `security.csp`, the injected script and the stylesheet are hashed or self-hosted
  like any other page asset.

**Limit for gated scripts:** under a hashed or strict CSP, only external scripts whose host
is allow-listed can be activated by consent gating. Gated inline code needs its own hash or
`'unsafe-inline'`.

## Accessibility

- The banner is a `role="dialog"` named by its title, and is `aria-modal` in blocking mode.
- Focus moves to the dialog on open and returns to the opener on close. Tab cycles inside a
  blocking dialog.
- Escape closes the settings dialog. It goes back to the banner while no choice exists yet, and
  otherwise returns focus to the control that opened it. Escape does nothing on a blocking banner.
- Switches are native checkboxes with labels. Buttons are real `<button>` elements with visible
  text, and the focus ring uses the `focus` colour.
- Animations are disabled under `prefers-reduced-motion: reduce`. Toggles stay legible in forced
  colours.
- Colour contrast is your config's responsibility. The build checks it.

## Requirements

- Browsers: current evergreen browsers. The package relies on the `inert` attribute, `:focus-visible`
  and CSS `translate`.
- Astro ≥ 5.4 for the integration, as an optional peer dependency.
- Node ≥ 22.

The browser entry has zero runtime dependencies. Its size budget is part of the public contract:
the core and its stylesheet stay at or under 6 KB gzipped.

## Versioning

The package follows semantic versioning. Within `0.x`, minor versions change the config schema
only additively. Any breaking change to the config, the cookie format or the state API bumps the
major version. See [CHANGELOG.md](./CHANGELOG.md).

## Releases and contributing

Releases are built and published from version tags by the repository's release workflow, with
npm provenance, and each version is approved by a maintainer before it is installable. The
procedure is in
[docs/releasing.md](https://github.com/EdgeSweden/theconsent/blob/main/docs/releasing.md).
How changes are planned, checked and reviewed is in
[docs/plan.md](https://github.com/EdgeSweden/theconsent/blob/main/docs/plan.md). Report
vulnerabilities as described in
[SECURITY.md](https://github.com/EdgeSweden/theconsent/blob/main/SECURITY.md).

## Licence

MIT
