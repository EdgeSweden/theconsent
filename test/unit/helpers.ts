import { Window } from "happy-dom";
import { vi } from "vitest";
import type { ConsentConfig } from "../../src/astro/schema";
import { encodeChoice, type StoredChoice } from "../../src/core/cookie";

export type CoreApi = typeof import("../../src/core/index");
export type CoreRuntime = typeof import("../../src/core/runtime");

export interface Harness {
  window: Window;
  doc: Document;
  /** Every string assigned to `document.cookie`. */
  cookieWrites: string[];
  /** Every read of `localStorage`, `sessionStorage` or `indexedDB`. */
  storageAccess: string[];
  fetch: ReturnType<typeof vi.fn>;
  sendBeacon: ReturnType<typeof vi.fn>;
  /** A fresh copy of the core module, so its singleton runtime starts unmounted. */
  api: CoreApi;
  /** The same module instance's internals, for driving choices before the UI exists. */
  runtime: CoreRuntime;
}

/** A fresh document at `url` with I/O spies, plus a fresh core module. */
export async function harness(
  options: { url?: string; lang?: string; cookie?: string | undefined } = {},
): Promise<Harness> {
  const window = new Window({ url: options.url ?? "https://example.com/" });
  const doc = window.document as unknown as Document;
  doc.documentElement.lang = options.lang ?? "en";
  // Set the starting cookie with the attributes the package writes, so a later write replaces it
  // (happy-dom keeps a Secure and a non-Secure cookie of the same name side by side).
  if (options.cookie !== undefined) {
    const secure = new URL(options.url ?? "https://example.com/").protocol === "https:";
    doc.cookie = `${options.cookie}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  const cookieWrites: string[] = [];
  const descriptor = findDescriptor(doc, "cookie");
  Object.defineProperty(doc, "cookie", {
    configurable: true,
    get: () => descriptor.get!.call(doc),
    set: (value: string) => {
      cookieWrites.push(value);
      descriptor.set!.call(doc, value);
    },
  });

  const storageAccess: string[] = [];
  for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => {
        storageAccess.push(name);
        return undefined;
      },
    });
  }

  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const sendBeacon = vi.fn(() => true);
  Object.defineProperty(window, "fetch", { configurable: true, value: fetch });
  Object.defineProperty(window.navigator, "sendBeacon", { configurable: true, value: sendBeacon });

  vi.resetModules();
  const api = (await import("../../src/core/index")) as CoreApi;
  const runtime = (await import("../../src/core/runtime")) as CoreRuntime;
  return { window, doc, cookieWrites, storageAccess, fetch, sendBeacon, api, runtime };
}

function findDescriptor(target: object, key: string): PropertyDescriptor {
  for (let proto: object | null = target; proto; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) return descriptor;
  }
  throw new Error(`no ${key} property`);
}

/** A cookie string for a stored choice. */
export function storedCookie(
  choice: Partial<StoredChoice> & Pick<StoredChoice, "c">,
  name = "consent",
): string {
  return `${name}=${encodeChoice({ v: 1, p: "2026-10", t: 1_760_000_000, ...choice })}`;
}

/** The decoded value of the consent cookie currently visible to `doc`. */
export function currentCookie(doc: Document, name = "consent"): unknown {
  const part = doc.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  return part === undefined
    ? undefined
    : JSON.parse(decodeURIComponent(part.slice(name.length + 1)));
}

export const ALL_GRANTED = { necessary: true, analytics: true, marketing: true };
export const ALL_DENIED = { necessary: true, analytics: false, marketing: false };

export type { ConsentConfig };
