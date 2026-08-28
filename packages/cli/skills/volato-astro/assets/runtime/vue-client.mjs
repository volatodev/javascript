import { captureBrowserError, initVolatoBrowser } from "./browser.mjs";

initVolatoBrowser();

export function captureVolatoVueError(error) {
  return captureBrowserError(error, { capturedVia: "vue_error_handler" });
}
