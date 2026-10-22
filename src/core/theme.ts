import type { ConsentConfig } from "../astro/schema";
import { colorVar } from "./tokens";

/**
 * Exactly the custom properties of the `THEME_COLORS` tokens (a test holds the two in step); a
 * pattern because the token list itself would cost the core bundle its size budget.
 */
export const COLOR_VAR =
  /^--consent-(background|text|muted|link|border|backdrop|focus|(accept|reject|settings|save)-(background|text)|toggle-(on|off|knob))$/;

/**
 * Applies the theme as `--consent-*` custom properties on the root element, one at a time
 * through `style.setProperty` (plan: CSP). The only other inline style is the linked-page spacer's
 * height, also set through `style.setProperty` (banner.ts). `vars` mirror
 * validation at runtime: only `--consent-*` names that are not a colour token, so a config
 * mounted without `validateConfig` cannot bypass the contrast check.
 */
export function applyTheme(root: HTMLElement, config: ConsentConfig): void {
  const set = (name: string, value: string | number | undefined): void => {
    if (value !== undefined) root.style.setProperty(name, String(value));
  };
  const theme = config.theme;
  for (const [token, value] of Object.entries(theme?.colors ?? {})) set(colorVar(token), value);
  set("--consent-radius-box", theme?.radius?.box);
  set("--consent-radius-button", theme?.radius?.button);
  set("--consent-radius-control", theme?.radius?.control);
  set("--consent-font", theme?.font);
  set("--consent-z", theme?.zIndex);
  set("--consent-width", config.layout?.width);
  for (const [name, value] of Object.entries(theme?.vars ?? {})) {
    if (name.startsWith("--consent-") && !COLOR_VAR.test(name)) set(name, value);
  }
}
