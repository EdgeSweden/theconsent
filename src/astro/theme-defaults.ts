import type { ThemeColor } from "../core/tokens";

/**
 * The stylesheet's default palette. The contrast check resolves config colours over these, and a
 * unit test keeps them identical to the values in `src/styles.css`. Accept and Reject share one
 * look so neither is more prominent (plan: Principles 2).
 */
export const DEFAULT_COLORS: Record<ThemeColor, string> = {
  background: "#ffffff",
  text: "#1f1f1f",
  muted: "#595959",
  link: "#0a58ca",
  border: "#d4d4d4",
  backdrop: "rgb(0 0 0 / 0.5)",
  focus: "#0a58ca",
  acceptBackground: "#1f1f1f",
  acceptText: "#ffffff",
  rejectBackground: "#1f1f1f",
  rejectText: "#ffffff",
  settingsBackground: "#ffffff",
  settingsText: "#1f1f1f",
  saveBackground: "#1f1f1f",
  saveText: "#ffffff",
  toggleOn: "#1f1f1f",
  toggleOff: "#767676",
  toggleKnob: "#ffffff",
};
