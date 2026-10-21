import type { ConsentConfig } from "@edgesweden/consent";
import base from "./consent.config.ts";

/** The same demo in non-blocking mode: the page stays usable and Close means "decide later". */
const config: ConsentConfig = {
  ...base,
  layout: { position: "bottom-right", blocking: false, backdrop: "none" },
};

export default config;
