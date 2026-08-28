import { captureBrowserError, initVolatoBrowser } from "./browser.mjs";

initVolatoBrowser();

function hydrationError(event) {
  let error;
  try {
    error = event?.detail?.error;
  } catch {
    error = undefined;
  }
  if (error === undefined) return;
  void captureBrowserError(error, { capturedVia: "astro_hydration_error" });
}

if (typeof document !== "undefined") {
  document.addEventListener("astro:hydration-error", hydrationError);
}
