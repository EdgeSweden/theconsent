import { describe, expect, test } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { validateConfig, type ValidationIssue } from "../../src/astro/validate";
import { baseConfig } from "./fixtures";

type Mutable = Record<string, unknown> & ConsentConfig;

function check(mutate: (config: Mutable) => void) {
  const config = baseConfig() as Mutable;
  mutate(config);
  return validateConfig(config);
}

function errorsOf(mutate: (config: Mutable) => void): ValidationIssue[] {
  const result = check(mutate);
  return result.ok ? [] : result.errors;
}

function expectError(mutate: (config: Mutable) => void, path: string, message?: RegExp): void {
  const errors = errorsOf(mutate);
  const match = errors.find((issue) => issue.path === path);
  expect(match, `expected an error at "${path}", got ${JSON.stringify(errors)}`).toBeDefined();
  if (message) expect(match?.message).toMatch(message);
}

function expectValid(mutate: (config: Mutable) => void = () => {}): void {
  const result = check(mutate);
  expect(result.ok ? [] : result.errors).toEqual([]);
}

describe("validateConfig", () => {
  test("the fixture config is valid and returned unchanged", () => {
    const result = validateConfig(baseConfig());
    expect(result).toEqual({ ok: true, config: baseConfig(), warnings: [] });
  });

  test("a non-object input fails at the root", () => {
    const result = validateConfig("nope");
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([""]);
  });

  describe("one pass: schema and cross-field errors together", () => {
    const paths = (mutate: (config: Mutable) => void) => errorsOf(mutate).map((e) => e.path);
    const sv = (config: Mutable) => config.locales["sv"]!;

    test("an unknown key and a missing locale string are both reported", () => {
      expect(
        paths((c) => {
          c["extra"] = true;
          delete sv(c).categories["analytics"];
        }),
      ).toEqual(expect.arrayContaining(["extra", "locales.sv.categories.analytics"]));
    });

    test("cross-field rules run next to unrelated schema errors", () => {
      const result = check((c) => {
        c["extra"] = 1;
        c.defaultLocale = "de";
        c.theme = { colors: { border: "nope", acceptText: "#777777" } };
        c.record = "//example.com/consent";
      });
      expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(
        expect.arrayContaining(["extra", "defaultLocale", "theme.colors.border", "record"]),
      );
    });

    test("contrast is checked next to unrelated schema errors", () => {
      const result = check((c) => {
        c["extra"] = 1;
        c.theme = { colors: { acceptText: "#777777" } };
      });
      expect(result.warnings.map((w) => w.path)).toEqual(["theme.colors.acceptText"]);
    });

    test("a locale with an unrelated schema error still gets its category-string check", () => {
      expect(
        paths((c) => {
          (sv(c) as Record<string, unknown>)["acceptAll"] = "";
          delete sv(c).categories["marketing"];
        }),
      ).toEqual(
        expect.arrayContaining(["locales.sv.acceptAll", "locales.sv.categories.marketing"]),
      );
    });

    test("a category with an unrelated error still counts for the locale checks", () => {
      const errors = paths((c) => {
        (c.categories[1] as Record<string, unknown>)["extra"] = 1;
        (c.categories[1]!.services![0] as Record<string, unknown>)["extra"] = 1;
      });
      expect(errors.sort()).toEqual(["categories[1].extra", "categories[1].services[0].extra"]);
    });

    test("strings for a category with an unrelated error are still required", () => {
      expect(
        paths((c) => {
          (c.categories[1] as Record<string, unknown>)["required"] = "yes";
          delete sv(c).categories["analytics"];
          delete sv(c).services!["stats"];
        }),
      ).toEqual(
        expect.arrayContaining([
          "categories[1].required",
          "locales.sv.categories.analytics",
          "locales.sv.services.stats",
        ]),
      );
    });

    test("a malformed part is reported once, by the schema", () => {
      expect(paths((c) => void (c.defaultLocale = ""))).toEqual(["defaultLocale"]);
      expect(paths((c) => void (c.categories = []))).toEqual(["categories"]);
      // The strings for the misspelt id are not also reported as strays.
      expect(paths((c) => void (c.categories[0]!.id = "Bad Id"))).toEqual(["categories[0].id"]);
      expect(paths((c) => void (c.categories[0]!.services![0]!.id = "Bad Id"))).toEqual([
        "categories[0].services[0].id",
      ]);
      // Items that are not objects, or services that are not an array.
      const any = (c: Mutable) => c as unknown as { categories: unknown[] };
      expect(paths((c) => void (any(c).categories[1] = "analytics"))).toEqual(["categories[1]"]);
      expect(paths((c) => void (any(c).categories[1] = null))).toEqual(["categories[1]"]);
      expect(
        paths(
          (c) => void ((c.categories[1] as Record<string, unknown>)["services"] = { id: "stats" }),
        ),
      ).toEqual(["categories[1].services"]);
      expect(
        paths((c) => void ((c.categories[1] as Record<string, unknown>)["services"] = ["stats"])),
      ).toEqual(["categories[1].services[0]"]);
      // A colour that is not a string is not replaced by a default in the contrast check.
      const strict = check((c) => {
        c.theme = { colors: { text: "#777", background: 5 as unknown as string } };
        c.validation = { strictContrast: true };
      });
      expect(strict.ok ? [] : strict.errors.map((e) => e.path)).toEqual([
        "theme.colors.background",
      ]);
      expect(strict.warnings).toEqual([]);
      // A link without a usable id: its tokens are not reported as unresolved.
      expect(paths((c) => void (c.locales["en"]!.links![0]!.id = ""))).toEqual([
        "locales.en.links[0].id",
      ]);
      expect(paths((c) => void ((c as Record<string, unknown>)["locales"] = []))).toEqual([
        "locales",
      ]);
    });
  });

  describe("schemaVersion and policyVersion", () => {
    test("schemaVersion must be 1", () => {
      expectError((c) => void (c.schemaVersion = 2 as never), "schemaVersion");
      expectError((c) => void delete (c as Partial<Mutable>).schemaVersion, "schemaVersion");
    });
    test("policyVersion is 1–32 characters", () => {
      expectValid((c) => void (c.policyVersion = "x"));
      expectValid((c) => void (c.policyVersion = "x".repeat(32)));
      expectError((c) => void (c.policyVersion = ""), "policyVersion");
      expectError((c) => void (c.policyVersion = "x".repeat(33)), "policyVersion", /32/);
    });
  });

  describe("ids", () => {
    test("category ids match the id pattern", () => {
      for (const good of ["a", "a1", "a_b-c", "a".repeat(32)]) {
        expectValid((c) => {
          c.categories[2]!.id = good;
          for (const l of Object.values(c.locales)) {
            l.categories[good] = l.categories.marketing!;
            if (good !== "marketing") delete l.categories.marketing;
          }
        });
      }
      for (const bad of ["", "A", "1a", "_a", "a b", "a".repeat(33), "ä"]) {
        expectError((c) => void (c.categories[2]!.id = bad), "categories[2].id", /must match/);
      }
    });
    test("category ids are unique", () => {
      expectError(
        (c) => void (c.categories[2]!.id = "analytics"),
        "categories[2].id",
        /duplicate category id "analytics"/,
      );
    });
    test("service ids match the id pattern", () => {
      expectError(
        (c) => void (c.categories[1]!.services![0]!.id = "Stats"),
        "categories[1].services[0].id",
      );
    });
    test("service ids are unique across all categories", () => {
      expectError(
        (c) => void (c.categories[2]!.services![0]!.id = "stats"),
        "categories[2].services[0].id",
        /duplicate service id "stats"/,
      );
    });
  });

  describe("categories", () => {
    test("at least one category is declared", () => {
      expectError((c) => void (c.categories = []), "categories");
    });
    test("at least one optional category exists", () => {
      expectError(
        (c) => {
          c.categories[1]!.required = true;
          c.categories[2]!.required = true;
        },
        "categories",
        /optional/,
      );
    });
    test("a config with no required category is valid", () => {
      expectValid((c) => void delete c.categories[0]!.required);
    });
    test("nothing is implied: no built-in necessary row is required", () => {
      expectValid((c) => {
        c.categories.splice(0, 1);
        for (const l of Object.values(c.locales)) {
          delete l.categories.necessary;
          delete l.services!.session;
        }
      });
    });
  });

  describe("locales", () => {
    test("defaultLocale is a key of locales", () => {
      expectValid((c) => void (c.defaultLocale = "sv"));
      expectError((c) => void (c.defaultLocale = "de"), "defaultLocale", /not a key of locales/);
    });
    test("locale, when given, is a key of locales", () => {
      expectValid((c) => void (c.locale = "sv"));
      expectError((c) => void (c.locale = "sv-SE"), "locale", /not a key of locales/);
    });
    test("every category id has strings in every locale", () => {
      expectError(
        (c) => void delete c.locales.sv!.categories.analytics,
        "locales.sv.categories.analytics",
        /missing/,
      );
    });
    test("every service id has strings in every locale", () => {
      expectError(
        (c) => void delete c.locales.en!.services!.ads,
        "locales.en.services.ads",
        /missing/,
      );
      expectError((c) => void delete c.locales.en!.services, "locales.en.services.ads");
    });
    test("a category string key that matches no id fails", () => {
      expectError(
        (c) => void (c.locales.en!.categories.analytcs = { name: "x", description: "" }),
        "locales.en.categories.analytcs",
        /no category/,
      );
    });
    test("a service string key that matches no id fails", () => {
      expectError(
        (c) => void (c.locales.sv!.services!.stat = { name: "x" }),
        "locales.sv.services.stat",
        /no service/,
      );
    });
    test("button labels must not be empty", () => {
      expectError((c) => void (c.locales.en!.rejectAll = ""), "locales.en.rejectAll");
    });
    test("an empty title needs a dialogLabel", () => {
      expectError((c) => void (c.locales.en!.title = ""), "locales.en.title", /dialogLabel/);
      expectValid((c) => {
        c.locales.en!.title = "";
        c.locales.en!.dialogLabel = "Cookie consent";
      });
    });
    test("missing required strings fail", () => {
      expectError(
        (c) => void delete (c.locales.en as Partial<typeof c.locales.en>)!.acceptAll,
        "locales.en.acceptAll",
      );
    });
  });

  describe("link tokens", () => {
    test("{link:<id>} in description resolves to a link of the same locale", () => {
      expectError(
        (c) => void (c.locales.sv!.description = "Läs {link:privacy}."),
        "locales.sv.description",
        /\{link:privacy\}/,
      );
    });
    test("{link:<id>} in settingsDescription resolves", () => {
      expectValid((c) => void (c.locales.en!.settingsDescription = "See {link:policy}."));
      expectError(
        (c) => void (c.locales.en!.settingsDescription = "See {link:terms}."),
        "locales.en.settingsDescription",
      );
    });
    test("a link of another locale does not satisfy the token", () => {
      expectError((c) => {
        c.locales.en!.links = [{ id: "terms", label: "terms", href: "/terms" }];
        c.locales.en!.description = "{link:terms}";
        c.locales.sv!.description = "{link:terms}";
      }, "locales.sv.description");
    });
    test("link ids are unique within a locale", () => {
      expectError(
        (c) => void c.locales.en!.links!.push({ id: "policy", label: "again", href: "/again" }),
        "locales.en.links[1].id",
      );
    });
    test("link hrefs may not use a script-capable scheme", () => {
      for (const good of [
        "/cookies",
        "cookies.html",
        "#policy",
        "https://example.com/p",
        "mailto:privacy@example.com",
      ]) {
        expectValid((c) => void (c.locales.en!.links![0]!.href = good));
      }
      for (const bad of [
        "javascript:alert(1)",
        " JavaScript:void(0)",
        "data:text/html,x",
        "vbscript:x",
        "java\tscript:alert(1)",
        "jav\nascript:alert(1)",
        "\x01javascript:alert(1)",
        "javascript\r:alert(1)",
      ]) {
        expectError((c) => void (c.locales.en!.links![0]!.href = bad), "locales.en.links[0].href");
      }
    });
  });

  describe("buttons.order", () => {
    test("omitted order is valid", () => {
      expectValid((c) => void (c.buttons = { settings: false }));
    });
    test("an exact permutation is valid", () => {
      expectValid((c) => void (c.buttons = { order: ["rejectAll", "settings", "acceptAll"] }));
      expectValid((c) => void (c.buttons = { settings: false, order: ["rejectAll", "acceptAll"] }));
    });
    test("omitting rejectAll fails", () => {
      expectError((c) => void (c.buttons = { order: ["acceptAll", "settings"] }), "buttons.order");
    });
    test("omitting acceptAll fails", () => {
      expectError((c) => void (c.buttons = { order: ["rejectAll", "settings"] }), "buttons.order");
    });
    test("a duplicate fails", () => {
      expectError(
        (c) => void (c.buttons = { order: ["acceptAll", "rejectAll", "settings", "rejectAll"] }),
        "buttons.order",
      );
    });
    test("omitting settings while enabled (the default) fails", () => {
      expectError((c) => void (c.buttons = { order: ["acceptAll", "rejectAll"] }), "buttons.order");
    });
    test("listing settings while disabled fails", () => {
      expectError(
        (c) =>
          void (c.buttons = { settings: false, order: ["acceptAll", "rejectAll", "settings"] }),
        "buttons.order",
        /disabled/,
      );
    });
    test("an unknown entry fails", () => {
      expectError(
        (c) => void (c.buttons = { order: ["acceptAll", "rejectAll", "close" as never] }),
        "buttons.order[2]",
      );
    });
  });

  describe("layout", () => {
    test("blocking requires backdrop dim", () => {
      expectValid((c) => void (c.layout = { blocking: true, backdrop: "dim" }));
      expectValid((c) => void (c.layout = { blocking: false, backdrop: "none" }));
      expectError((c) => void (c.layout = { blocking: true, backdrop: "none" }), "layout.blocking");
    });
    test("backdrop none with the default blocking mode fails", () => {
      expectError((c) => void (c.layout = { backdrop: "none" }), "layout.backdrop", /blocking/);
    });
    test("position is one of the listed values", () => {
      expectValid((c) => void (c.layout = { position: "top-center" }));
      expectError((c) => void (c.layout = { position: "middle" as never }), "layout.position");
    });
    test("settingsPosition is center", () => {
      expectError(
        (c) => void (c.layout = { settingsPosition: "left" as never }),
        "layout.settingsPosition",
      );
    });
  });

  describe("theme", () => {
    test("every colour value parses as a CSS colour", () => {
      expectValid(
        (c) =>
          void (c.theme = { colors: { border: "rgb(0 0 0 / 10%)", link: "oklch(45% 0.2 260)" } }),
      );
      for (const bad of ["notacolour", "#12", "rgb(1 2)", "var(--x)", "currentcolor"]) {
        expectError(
          (c) => void (c.theme = { colors: { border: bad } }),
          "theme.colors.border",
          /colour/,
        );
      }
    });
    test("an unknown colour token fails", () => {
      expectError(
        (c) => void (c.theme = { colors: { buttonText: "#000" } as never }),
        "theme.colors.buttonText",
      );
    });
    test("insufficient text contrast is a warning by default", () => {
      const result = check((c) => void (c.theme = { colors: { text: "#aaaaaa" } }));
      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([
        { path: "theme.colors.text", message: expect.stringMatching(/text on background.*4\.5:1/) },
      ]);
    });
    test.each([
      ["acceptText", "acceptBackground"],
      ["rejectText", "rejectBackground"],
      ["settingsText", "settingsBackground"],
      ["saveText", "saveBackground"],
    ] as const)("insufficient %s on %s is checked", (fg, bg) => {
      const result = check(
        (c) => void (c.theme = { colors: { [fg]: "#777777", [bg]: "#888888" } }),
      );
      expect(result.warnings.map((w) => w.message).join()).toContain(`${fg} on ${bg}`);
    });
    test("strictContrast makes a contrast failure fail the build", () => {
      expectError(
        (c) => {
          c.theme = { colors: { background: "#222222" } };
          c.validation = { strictContrast: true };
        },
        "theme.colors.background",
        /contrast/,
      );
    });
    test("sufficient contrast produces no warning", () => {
      const result = check(
        (c) => void (c.theme = { colors: { text: "#000", background: "white" } }),
      );
      expect(result.warnings).toEqual([]);
    });
    test("theme.vars may not name a colour token's custom property", () => {
      expectValid((c) => void (c.theme = { vars: { "--consent-gap": "1rem" } }));
      expectError(
        (c) => void (c.theme = { vars: { "--consent-accept-background": "#eee" } }),
        "theme.vars.--consent-accept-background",
        /theme\.colors/,
      );
    });
    test("theme.vars keys must use the --consent- prefix", () => {
      expectError(
        (c) => void (c.theme = { vars: { "--brand": "red" } as never }),
        "theme.vars.--brand",
      );
    });
    test("zIndex is an integer", () => {
      expectValid((c) => void (c.theme = { zIndex: 10 }));
      expectError((c) => void (c.theme = { zIndex: 1.5 }), "theme.zIndex");
    });
  });

  describe("record", () => {
    test("a function is accepted", () => {
      expectValid((c) => void (c.record = () => {}));
    });
    test("a root-relative path or absolute http(s) URL is accepted", () => {
      for (const url of ["/consent", "https://example.com/consent", "http://example.org/c?x=1"]) {
        expectValid((c) => void (c.record = url));
      }
    });
    test("other schemes, scheme-relative and relative URLs fail", () => {
      for (const url of [
        "//example.com/c",
        "/\\example.com",
        "/\t/example.com/c",
        "/\n/example.com/c",
        "/\r/example.com/c",
        "/ /example.com/c",
        "\x00/consent",
        "ftp://example.com",
        "javascript:x",
        "consent",
        "",
        "https:/x",
        "https:example.com",
        "https://exa mple.com",
      ]) {
        expectError((c) => void (c.record = url), "record");
      }
    });
    test("a non-function, non-string value fails", () => {
      expectError((c) => void (c.record = 42 as never), "record");
    });
  });

  describe("cookie", () => {
    test("valid cookie options pass", () => {
      expectValid(
        (c) =>
          void (c.cookie = {
            name: "site_consent",
            maxAgeDays: 180,
            domain: "example.com",
            path: "/",
          }),
      );
    });
    test("an invalid cookie name fails", () => {
      expectError((c) => void (c.cookie = { name: "a b;" }), "cookie.name");
    });
    test("maxAgeDays is positive", () => {
      expectError((c) => void (c.cookie = { maxAgeDays: 0 }), "cookie.maxAgeDays");
    });
    test("path starts with / and cannot inject attributes", () => {
      expectError((c) => void (c.cookie = { path: "x" }), "cookie.path");
      expectError((c) => void (c.cookie = { path: "/; Domain=example.org" }), "cookie.path");
    });
    test("domain is a host name and cannot inject attributes", () => {
      expectValid((c) => void (c.cookie = { domain: ".example.com" }));
      expectError((c) => void (c.cookie = { domain: "example.com; Secure" }), "cookie.domain");
      expectError((c) => void (c.cookie = { domain: "" }), "cookie.domain");
    });
  });

  describe("unknown keys", () => {
    test.each([
      ["", (c: Mutable) => void (c.extra = 1)],
      ["cookie.secure", (c: Mutable) => void (c.cookie = { secure: true } as never)],
      [
        "categories[0].name",
        (c: Mutable) => void ((c.categories[0] as Record<string, unknown>).name = "x"),
      ],
      [
        "categories[1].services[0].url",
        (c: Mutable) => void ((c.categories[1]!.services![0] as Record<string, unknown>).url = "x"),
      ],
      [
        "locales.en.subtitle",
        (c: Mutable) => void ((c.locales.en as Record<string, unknown>).subtitle = "x"),
      ],
      [
        "locales.en.categories.analytics.label",
        (c: Mutable) =>
          void ((c.locales.en!.categories.analytics as Record<string, unknown>).label = "x"),
      ],
      ["layout.animate", (c: Mutable) => void (c.layout = { animate: true } as never)],
      ["theme.shadow", (c: Mutable) => void (c.theme = { shadow: "x" } as never)],
      ["theme.radius.card", (c: Mutable) => void (c.theme = { radius: { card: "1px" } } as never)],
      ["validation.strict", (c: Mutable) => void (c.validation = { strict: true } as never)],
      ["buttons.close", (c: Mutable) => void (c.buttons = { close: true } as never)],
      ["gpc", (c: Mutable) => void (c.gpc = true)],
    ])("an unknown key at %s fails", (path, mutate) => {
      const expected = path === "" ? "extra" : path;
      expectError(mutate, expected, /unknown key/);
    });
  });

  describe("gateScripts", () => {
    test("a boolean is accepted", () => {
      expectValid((c) => void (c.gateScripts = true));
      expectValid((c) => void (c.gateScripts = false));
    });
    test("anything else fails", () => {
      expectError((c) => void (c.gateScripts = "yes" as never), "gateScripts");
    });
  });

  describe("consentMode", () => {
    test("a mapping with extra keys outside any category is valid", () => {
      expectValid(
        (c) =>
          void (c.consentMode = {
            mapping: { necessary: ["security_storage"], marketing: ["ad_storage", "ad_user_data"] },
            extra: { functionality_storage: "granted", personalization_storage: "denied" },
          }),
      );
    });
    test("a mapped category must exist", () => {
      expectError(
        (c) => void (c.consentMode = { mapping: { ads: ["ad_storage"] } }),
        "consentMode.mapping.ads",
        /no category/,
      );
    });
    test("a key listed twice in one category fails", () => {
      expectError(
        (c) => void (c.consentMode = { mapping: { marketing: ["ad_storage", "ad_storage"] } }),
        "consentMode.mapping.marketing[1]",
        /one category/,
      );
    });
    test("a key in two categories fails", () => {
      expectError(
        (c) =>
          void (c.consentMode = {
            mapping: { analytics: ["analytics_storage"], marketing: ["analytics_storage"] },
          }),
        "consentMode.mapping.marketing[0]",
        /consentMode\.mapping\.analytics/,
      );
    });
    test("a key in both mapping and extra fails", () => {
      expectError(
        (c) =>
          void (c.consentMode = {
            mapping: { analytics: ["analytics_storage"] },
            extra: { analytics_storage: "granted" },
          }),
        "consentMode.extra.analytics_storage",
        /mapped or extra/,
      );
    });
    test("unknown gtag keys and values fail", () => {
      expectError(
        (c) => void (c.consentMode = { mapping: { analytics: ["analytics" as never] } }),
        "consentMode.mapping.analytics[0]",
      );
      expectError(
        (c) => void (c.consentMode = { mapping: {}, extra: { ad_storage: "yes" as never } }),
        "consentMode.extra.ad_storage",
      );
      expectError(
        (c) => void (c.consentMode = { mapping: {}, extra: { cookies: "granted" } as never }),
        "consentMode.extra.cookies",
      );
    });
    test("unknown keys inside consentMode fail", () => {
      expectError(
        (c) => void (c.consentMode = { mapping: {}, region: ["SE"] } as never),
        "consentMode.region",
        /unknown key/,
      );
    });
  });
});
