import { z } from "zod";
import { BUTTONS, THEME_COLORS } from "../core/tokens";
import type { ConsentRecorder } from "../core/types";

/** Category and service ids (plan: Config). */
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** RFC 6265 cookie-name token characters. */
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const COOKIE_DOMAIN = /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const COOKIE_PATH = /^\/[^;\s]*$/;

/** Google Consent Mode v2 keys (plan: Google Consent Mode v2). */
export const GTAG_CONSENT_KEYS = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
  "analytics_storage",
  "functionality_storage",
  "personalization_storage",
  "security_storage",
] as const;

const gtagKey = z.enum(GTAG_CONSENT_KEYS);

const id = z.string().regex(ID_PATTERN, `must match ${ID_PATTERN}`);
const label = z.string().min(1, "must not be empty");

const service = z.strictObject({
  id,
  cookies: z.array(label).optional(),
});

const category = z.strictObject({
  id,
  required: z.boolean().optional(),
  services: z.array(service).optional(),
});

const localeStrings = z.strictObject({
  title: z.string(),
  description: z.string(),
  acceptAll: label,
  rejectAll: label,
  settings: label,
  save: label,
  close: label,
  alwaysActive: label,
  settingsTitle: label,
  settingsDescription: z.string().optional(),
  dialogLabel: label.optional(),
  links: z.array(z.strictObject({ id: label, label, href: label })).optional(),
  categories: z.record(z.string(), z.strictObject({ name: label, description: z.string() })),
  services: z
    .record(z.string(), z.strictObject({ name: label, description: z.string().optional() }))
    .optional(),
});

const themeColors = z.strictObject(
  Object.fromEntries(THEME_COLORS.map((token) => [token, z.string().optional()])) as {
    [K in (typeof THEME_COLORS)[number]]: z.ZodOptional<z.ZodString>;
  },
);

export const consentConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  policyVersion: z.string().min(1, "must not be empty").max(32, "must be at most 32 characters"),
  cookie: z
    .strictObject({
      name: z.string().regex(COOKIE_NAME, "must be a valid cookie name").optional(),
      maxAgeDays: z.number().positive().finite().optional(),
      domain: z.string().regex(COOKIE_DOMAIN, "must be a host name").optional(),
      path: z
        .string()
        .regex(COOKIE_PATH, "must start with / and contain no ; or whitespace")
        .optional(),
    })
    .optional(),
  defaultLocale: label,
  locale: label.optional(),
  categories: z.array(category).min(1, "must declare at least one category"),
  locales: z.record(label, localeStrings),
  layout: z
    .strictObject({
      position: z
        .enum([
          "bottom-left",
          "bottom-right",
          "bottom-center",
          "top-left",
          "top-right",
          "top-center",
          "center",
        ])
        .optional(),
      backdrop: z.enum(["dim", "none"]).optional(),
      blocking: z.boolean().optional(),
      width: label.optional(),
      settingsPosition: z.literal("center").optional(),
    })
    .optional(),
  theme: z
    .strictObject({
      colors: themeColors.optional(),
      radius: z
        .strictObject({
          box: label.optional(),
          button: label.optional(),
          control: label.optional(),
        })
        .optional(),
      font: label.optional(),
      zIndex: z.number().int().optional(),
      vars: z
        .record(z.templateLiteral(["--consent-", z.string().regex(/^[a-z0-9-]+$/)]), z.string())
        .optional(),
    })
    .optional(),
  validation: z.strictObject({ strictContrast: z.boolean().optional() }).optional(),
  buttons: z
    .strictObject({
      settings: z.boolean().optional(),
      order: z.array(z.enum(BUTTONS)).optional(),
    })
    .optional(),
  /** Google Consent Mode v2 adapter (entry "./gtag"); added in v0.2.0. */
  consentMode: z
    .strictObject({
      mapping: z.record(z.string(), z.array(gtagKey)),
      extra: z.partialRecord(gtagKey, z.enum(["granted", "denied"])).optional(),
    })
    .optional(),
  /** Script-gating adapter (entry "./gate"); added in v0.2.0. */
  gateScripts: z.boolean().optional(),
  record: z
    .union([
      z.string(),
      z.custom<ConsentRecorder>((value) => typeof value === "function", {
        message: "must be a function or a URL string",
      }),
    ])
    .optional(),
});

/** The validated config (plan: Config, schema version 1). Derived from the schema. */
export type ConsentConfig = z.infer<typeof consentConfigSchema>;
export type LocaleStrings = z.infer<typeof localeStrings>;
export type ConsentCategory = z.infer<typeof category>;
export type GtagConsentKey = (typeof GTAG_CONSENT_KEYS)[number];
