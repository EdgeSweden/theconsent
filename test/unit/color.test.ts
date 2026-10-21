import { describe, expect, test } from "vitest";
import { contrastRatio, parseColor, type Rgba } from "../../src/astro/color";
import { DEFAULT_COLORS } from "../../src/astro/theme-defaults";

const rgb = (color: Rgba | null): number[] | null =>
  color && [
    Math.round(color.r),
    Math.round(color.g),
    Math.round(color.b),
    Number(color.a.toFixed(2)),
  ];

describe("parseColor", () => {
  test.each([
    ["#fff", [255, 255, 255, 1]],
    ["#FFFFFF", [255, 255, 255, 1]],
    ["#0000ff80", [0, 0, 255, 0.5]],
    ["#f008", [255, 0, 0, 0.53]],
    ["white", [255, 255, 255, 1]],
    ["RebeccaPurple", [102, 51, 153, 1]],
    ["transparent", [0, 0, 0, 0]],
    ["rgb(255, 0, 0)", [255, 0, 0, 1]],
    ["rgba(255, 0, 0, 0.5)", [255, 0, 0, 0.5]],
    ["rgb(100% 0% 0% / 50%)", [255, 0, 0, 0.5]],
    ["rgb(0 0 0 / 0.5)", [0, 0, 0, 0.5]],
    ["hsl(120, 100%, 50%)", [0, 255, 0, 1]],
    ["hsl(0.5turn 100% 50%)", [0, 255, 255, 1]],
    ["hsl(120 100 50)", [0, 255, 0, 1]],
    ["rgb(none 0 0)", [0, 0, 0, 1]],
    ["hsla(240deg 100% 50% / 1)", [0, 0, 255, 1]],
    ["hwb(0 0% 0%)", [255, 0, 0, 1]],
    ["hwb(0 50% 50%)", [128, 128, 128, 1]],
    ["oklch(62.8% 0.2577 29.23)", [255, 0, 0, 1]],
    ["oklab(1 0 0)", [255, 255, 255, 1]],
    ["lab(54.29 80.8 69.89)", [255, 0, 0, 1]],
    ["lch(100% 0 0)", [255, 255, 255, 1]],
  ])("%s", (input, expected) => {
    expect(rgb(parseColor(input))).toEqual(expected);
  });

  test.each([
    "",
    "#12",
    "#12345",
    "#gggggg",
    "notacolour",
    "currentcolor",
    "inherit",
    "var(--x)",
    "color-mix(in srgb, red, blue)",
    "color(srgb 1 0 0)",
    "rgb(1 2)",
    "rgb(1 2 3 4)",
    "rgb(1, 2 3)",
    "rgb(a b c)",
    "rgb(1 2 3 / 4 / 5)",
    "rgb(50%, 10, 20)",
    "rgb(none, 10, 20)",
    "rgba(10, 20, 30, none)",
    "hsl(120, 50, 50)",
  ])("rejects %j", (input) => {
    expect(parseColor(input)).toBeNull();
  });
});

describe("contrastRatio", () => {
  const white = parseColor("#fff")!;
  const black = parseColor("#000")!;
  test("black on white is 21:1 and symmetric", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
  });
  test("identical colours are 1:1", () => {
    expect(contrastRatio(white, white)).toBe(1);
  });
  test("#767676 on white is just above 4.5:1", () => {
    expect(contrastRatio(parseColor("#767676")!, white)).toBeCloseTo(4.54, 2);
  });
  test("a translucent foreground is composited over the background", () => {
    expect(contrastRatio(parseColor("rgb(0 0 0 / 0)")!, white)).toBe(1);
  });
  test("a translucent background is composited over white", () => {
    expect(contrastRatio(black, parseColor("transparent")!)).toBeCloseTo(21, 5);
  });
});

describe("default palette", () => {
  test("every default colour parses", () => {
    for (const value of Object.values(DEFAULT_COLORS)) expect(parseColor(value)).not.toBeNull();
  });
  test.each([
    ["text", "background"],
    ["acceptText", "acceptBackground"],
    ["rejectText", "rejectBackground"],
    ["settingsText", "settingsBackground"],
    ["saveText", "saveBackground"],
    ["muted", "background"],
    ["link", "background"],
  ] as const)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(
      contrastRatio(parseColor(DEFAULT_COLORS[fg])!, parseColor(DEFAULT_COLORS[bg])!),
    ).toBeGreaterThanOrEqual(4.5);
  });
  test("Accept all and Reject all share one look by default", () => {
    expect(DEFAULT_COLORS.acceptBackground).toBe(DEFAULT_COLORS.rejectBackground);
    expect(DEFAULT_COLORS.acceptText).toBe(DEFAULT_COLORS.rejectText);
  });
});
