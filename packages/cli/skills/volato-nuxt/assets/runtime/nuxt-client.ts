import { captureBrowserError, initVolatoBrowser } from "./browser";

type NuxtErrorFlags = {
  fatal?: unknown;
  unhandled?: unknown;
};

function isUnexpectedAppError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return value instanceof Error;
  const flags = value as NuxtErrorFlags;
  if ("fatal" in flags || "unhandled" in flags) {
    return flags.fatal === true || flags.unhandled === true;
  }
  return value instanceof Error;
}

export function installVolatoNuxtClient(): void {
  initVolatoBrowser();
}

export function captureVolatoNuxtVueError(error: unknown): void {
  void captureBrowserError(error, { capturedVia: "nuxt_app_error" });
}

export function captureVolatoNuxtAppError(error: unknown): void {
  if (!isUnexpectedAppError(error)) return;
  void captureBrowserError(error, { capturedVia: "nuxt_app_error" });
}
