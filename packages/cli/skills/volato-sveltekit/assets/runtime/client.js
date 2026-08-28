import { captureBrowserError, initVolatoBrowser } from "./browser.js";

initVolatoBrowser();

export function createVolatoSvelteKitClientHandleError(application) {
  return function volatoSvelteKitClientHandleError(input) {
    void captureBrowserError(input.error, {
      capturedVia: "sveltekit_client_handle_error",
    });
    if (application) return application.call(this, input);
    return { message: input.message };
  };
}
