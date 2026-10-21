import type { ConsentConfig } from "../astro/schema";
import { colorVar } from "./tokens";

/**
 * Applies the theme as `--consent-*` custom properties on the root element, one at a time
 * through `style.setProperty` (plan: CSP). Nothing else touches inline style.
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
  for (const [name, value] of Object.entries(theme?.vars ?? {})) set(name, value);
}
