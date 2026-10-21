/**
 * Build-time CSS colour parsing and WCAG 2.1 contrast (plan: Validation). Supports the colour
 * syntaxes a theme is realistically written in: hex, rgb()/rgba(), hsl()/hsla(), hwb(),
 * lab()/lch(), oklab()/oklch(), named colours and `transparent`. Anything else (`currentcolor`,
 * `var()`, `color-mix()`, `color()`) has no static value and is rejected.
 */

/** sRGB channels 0–255 and alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const channel = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return {
    r: channel(0),
    g: channel(1),
    b: channel(2),
    a: full.length === 8 ? channel(3) / 255 : 1,
  };
}

/** A numeric token: plain number, percentage, or angle; `none` is 0. */
interface Token {
  value: number;
  unit: "" | "%" | "deg" | "rad" | "grad" | "turn";
}

function parseToken(raw: string): Token | null {
  if (raw === "none") return { value: 0, unit: "" };
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(raw);
  if (!match) return null;
  return { value: Number(match[1]), unit: (match[2]?.toLowerCase() ?? "") as Token["unit"] };
}

/** Splits `fn(a b c / d)` or `fn(a, b, c, d)` into three channel tokens and an optional alpha. */
function parseArgs(
  body: string,
): { channels: Token[]; alpha: Token | null; legacy: boolean } | null {
  let parts: string[];
  let alphaRaw: string | undefined;
  let legacy = false;
  if (body.includes(",")) {
    legacy = true;
    parts = body.split(",").map((p) => p.trim());
    if (parts.includes("none")) return null; // `none` exists only in the modern syntax
    if (parts.length === 4) alphaRaw = parts.pop();
  } else {
    const [main = "", alpha, extra] = body.split("/").map((p) => p.trim());
    if (extra !== undefined) return null;
    parts = main.split(/\s+/).filter(Boolean);
    alphaRaw = alpha;
  }
  if (parts.length !== 3) return null;
  const channels = parts.map(parseToken);
  if (channels.some((c) => c === null)) return null;
  const alpha = alphaRaw === undefined ? null : parseToken(alphaRaw);
  if (alphaRaw !== undefined && alpha === null) return null;
  return { channels: channels as Token[], alpha, legacy };
}

const alphaOf = (token: Token | null): number =>
  token === null ? 1 : clamp(token.unit === "%" ? token.value / 100 : token.value, 0, 1);

function hue(token: Token): number {
  switch (token.unit) {
    case "rad":
      return (token.value * 180) / Math.PI;
    case "grad":
      return token.value * 0.9;
    case "turn":
      return token.value * 360;
    default:
      return token.value;
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  // CIE Lab (D50) → XYZ (D50) → XYZ (D65, Bradford) → linear sRGB.
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const e = 216 / 24389;
  const k = 24389 / 27;
  const xr = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
  const yr = L > k * e ? fy ** 3 : L / k;
  const zr = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
  const X = (xr * 0.3457) / 0.3585;
  const Y = yr;
  const Z = (zr * (1 - 0.3457 - 0.3585)) / 0.3585;
  const x = 0.9554734527042182 * X - 0.023098536874261423 * Y + 0.0632593086610217 * Z;
  const y = -0.028369706963208136 * X + 1.0099954580058226 * Y + 0.021041398966943008 * Z;
  const z = 0.012314001688319899 * X - 0.020507696433477912 * Y + 1.3303659366080753 * Z;
  return [
    linearToSrgb(3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z),
    linearToSrgb(-0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z),
    linearToSrgb(0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z),
  ];
}

const unit01 = (token: Token, percentScale: number): number =>
  token.unit === "%" ? token.value / 100 : token.value / percentScale;

const fromUnit = ([r, g, b]: [number, number, number], a: number): Rgba => ({
  r: clamp(r, 0, 1) * 255,
  g: clamp(g, 0, 1) * 255,
  b: clamp(b, 0, 1) * 255,
  a,
});

/** Parses a CSS colour string, or returns `null` when it is not a supported static colour. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (value.startsWith("#")) return parseHex(value.slice(1));
  const named = NAMED[value];
  if (named !== undefined) return parseHex(named);

  const fn = /^([a-z]+)\((.*)\)$/.exec(value);
  if (!fn) return null;
  const [, name = "", body = ""] = fn;
  const args = parseArgs(body.trim());
  if (!args) return null;
  const [c0, c1, c2] = args.channels as [Token, Token, Token];
  const alpha = alphaOf(args.alpha);

  switch (name) {
    case "rgb":
    case "rgba":
      // The legacy comma syntax requires all-numbers or all-percentages.
      if (args.legacy && new Set([c0.unit, c1.unit, c2.unit]).size > 1) return null;
      return fromUnit([unit01(c0, 255), unit01(c1, 255), unit01(c2, 255)], alpha);
    case "hsl":
    case "hsla":
      // The legacy comma syntax requires percentages for saturation and lightness.
      if (args.legacy && (c1.unit !== "%" || c2.unit !== "%")) return null;
      return fromUnit(
        hslToRgb(((hue(c0) % 360) + 360) % 360, unit01(c1, 100), unit01(c2, 100)),
        alpha,
      );
    case "hwb": {
      const w = unit01(c1, 100);
      const bl = unit01(c2, 100);
      if (w + bl >= 1) {
        const gray = w / (w + bl);
        return fromUnit([gray, gray, gray], alpha);
      }
      const [r, g, b] = hslToRgb(((hue(c0) % 360) + 360) % 360, 1, 0.5);
      const scale = 1 - w - bl;
      return fromUnit([r * scale + w, g * scale + w, b * scale + w], alpha);
    }
    case "lab":
      return fromUnit(labToRgb(c0.value, scaled(c1, 125), scaled(c2, 125)), alpha);
    case "lch": {
      const C = scaled(c1, 150);
      const h = (hue(c2) * Math.PI) / 180;
      return fromUnit(labToRgb(c0.value, C * Math.cos(h), C * Math.sin(h)), alpha);
    }
    case "oklab":
      return fromUnit(oklabToRgb(unit01(c0, 1), scaled(c1, 0.4), scaled(c2, 0.4)), alpha);
    case "oklch": {
      const C = scaled(c1, 0.4);
      const h = (hue(c2) * Math.PI) / 180;
      return fromUnit(oklabToRgb(unit01(c0, 1), C * Math.cos(h), C * Math.sin(h)), alpha);
    }
    default:
      return null;
  }
}

/** A percentage maps 100% to `full`; a plain number is taken as is. */
const scaled = (token: Token, full: number): number =>
  token.unit === "%" ? (token.value / 100) * full : token.value;

/** Source-over composite of `top` on an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * WCAG 2.1 contrast ratio of `foreground` on `background`. A translucent background is first
 * composited on white (the page behind the banner is unknown), then the foreground on that.
 */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const bg = background.a < 1 ? composite(background, WHITE) : background;
  const fg = foreground.a < 1 ? composite(foreground, bg) : foreground;
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
