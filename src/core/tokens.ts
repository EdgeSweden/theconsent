/** Theme colour tokens (plan: Config). Each maps to one `--consent-<kebab-case>` property. */
export const THEME_COLORS = [
  "background",
  "text",
  "muted",
  "link",
  "border",
  "backdrop",
  "focus",
  "acceptBackground",
  "acceptText",
  "rejectBackground",
  "rejectText",
  "settingsBackground",
  "settingsText",
  "saveBackground",
  "saveText",
  "toggleOn",
  "toggleOff",
  "toggleKnob",
] as const;

export type ThemeColor = (typeof THEME_COLORS)[number];

/** `acceptBackground` → `--consent-accept-background`. */
export const colorVar = (token: string): string =>
  `--consent-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export const BUTTONS = ["acceptAll", "rejectAll", "settings"] as const;
export type ButtonId = (typeof BUTTONS)[number];

export const DEFAULT_COOKIE_NAME = "consent";
export const DEFAULT_MAX_AGE_DAYS = 365;
