import { captureBrowserError, initVolatoBrowser } from "./browser.js";

function isUnexpectedAppError(value) {
  if (typeof value !== "object" || value === null) return value instanceof Error;
  if ("fatal" in value || "unhandled" in value) {
    return value.fatal === true || value.unhandled === true;
  }
  return value instanceof Error;
}

export function installVolatoNuxtClient() {
  initVolatoBrowser();
}

export function captureVolatoNuxtVueError(error) {
  void captureBrowserError(error, { capturedVia: "nuxt_app_error" });
}

export function captureVolatoNuxtAppError(error) {
  if (!isUnexpectedAppError(error)) return;
  void captureBrowserError(error, { capturedVia: "nuxt_app_error" });
}
