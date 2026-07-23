/**
 * Best-effort browser identification for `contexts.browser`.
 *
 * Prefers the modern `navigator.userAgentData.brands` array (entropy-low,
 * not subject to UA freezing). Falls back to a small UA-string regex
 * battery for browsers that haven't shipped UA-CH yet (Safari at the
 * time of writing). Returns `undefined` when nothing useful can be
 * pulled — the renderer just omits the line in that case.
 *
 * Pure: no side effects, safe to call from any client-side code path.
 */

export type BrowserContext = {
  name: string;
  version?: string;
};

type UADataBrand = { brand: string; version: string };
type NavigatorWithUAData = Navigator & {
  userAgentData?: { brands?: UADataBrand[] };
};

const KNOWN_BRANDS: readonly string[] = [
  "Google Chrome",
  "Microsoft Edge",
  "Opera",
  "Brave",
  "Arc",
  "Vivaldi",
];

function fromUAData(nav: NavigatorWithUAData): BrowserContext | undefined {
  const brands = nav.userAgentData?.brands;
  if (!brands || brands.length === 0) return undefined;
  // Pick the first brand that matches a real browser, skipping the
  // `Not_A Brand` and `Chromium` entries used for UA-CH dust storms.
  for (const brand of brands) {
    if (KNOWN_BRANDS.includes(brand.brand)) {
      return { name: brand.brand, version: brand.version };
    }
  }
  // Fallback to the first non-`Not_A Brand` entry.
  for (const brand of brands) {
    if (!brand.brand.startsWith("Not")) {
      return { name: brand.brand, version: brand.version };
    }
  }
  return undefined;
}

const UA_FALLBACKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "Edge", re: /Edg\/(\d+\.\d+)/ },
  { name: "Opera", re: /OPR\/(\d+\.\d+)/ },
  { name: "Firefox", re: /Firefox\/(\d+\.\d+)/ },
  { name: "Chrome", re: /Chrome\/(\d+\.\d+)/ },
  // Safari last — Chrome's UA includes "Safari/...", so Safari must
  // only match when Chrome didn't.
  { name: "Safari", re: /Version\/(\d+\.\d+).+Safari\// },
];

function fromUserAgent(ua: string): BrowserContext | undefined {
  for (const { name, re } of UA_FALLBACKS) {
    const m = ua.match(re);
    if (m && m[1]) return { name, version: m[1] };
  }
  return undefined;
}

export function detectBrowserContext(): BrowserContext | undefined {
  if (typeof navigator === "undefined") return undefined;
  const fromCh = fromUAData(navigator as NavigatorWithUAData);
  if (fromCh) return fromCh;
  if (typeof navigator.userAgent === "string") {
    return fromUserAgent(navigator.userAgent);
  }
  return undefined;
}
