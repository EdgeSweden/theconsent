import type { ConsentRecord, ConsentRecorder } from "./types";

/**
 * Delivers a consent record (plan: Record). A function recorder owns its transport; a string is
 * a URL that receives the bare record as JSON via `sendBeacon`, falling back to `fetch` with
 * `keepalive`. Every failure is swallowed: recording never surfaces to the visitor.
 */
export function sendRecord(
  win: Window,
  recorder: ConsentRecorder | string,
  record: ConsentRecord,
): void {
  try {
    if (typeof recorder === "function") {
      const result = recorder(record);
      if (result && typeof result.then === "function") result.then(undefined, () => {});
      return;
    }
    const body = JSON.stringify(record);
    let sent = false;
    try {
      sent =
        win.navigator.sendBeacon?.(recorder, new Blob([body], { type: "application/json" })) ===
        true;
    } catch {
      sent = false;
    }
    if (!sent) {
      win
        .fetch(recorder, {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body,
        })
        .catch(() => {});
    }
  } catch {
    // A throwing recorder or transport must not break the choice.
  }
}
